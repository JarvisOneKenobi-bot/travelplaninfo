import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlock, MessageParam, Tool, ToolResultBlockParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { getAnthropicApiKey } from "@/lib/server-config";
import { buildAtlasSystemPrompt } from "./system-prompt";
import { isSpendCapReached, recordAssistantSpend } from "./spend";
import { encodeSseData } from "./sse";
import { getDeals, INVALID_IATA_REASON, parseIata, searchFlights } from "./travelpayouts-client";
import { getSurpriseDestinations } from "./surprise";
import {
  renderDealsToolResult,
  renderSearchFlightsToolResult,
  renderSurpriseToolResult,
} from "./tool-render";
import { getArticleTool } from "./tools/get-article";

const MODEL = "claude-sonnet-5";
const MAX_TOOL_ITERATIONS = 5;
const MAX_TOKENS = 4096;
const ERROR_FRAME = 'data: {"error": "Atlas is taking a nap. Please try again in a moment."}\n\n';
const REFUSAL_FRAME =
  'data: {"error": "Atlas can\'t help with that request. Try rephrasing or asking something else."}\n\n';
const CUTOFF_FRAME =
  'data: {"error": "Atlas\'s reply was cut short. Please try again."}\n\n';
const DONE_FRAME = "data: [DONE]\n\n";

export const TOOLS: Tool[] = [
  {
    name: "search_flights",
    description:
      "Search real flight prices for a route and date via Travelpayouts/Aviasales. Call this when the user asks about flight prices, availability, or booking options for a specific trip.",
    input_schema: {
      type: "object",
      properties: {
        origin: { type: "string", description: "Origin airport IATA code" },
        destination: { type: "string", description: "Destination airport IATA code" },
        depart_date: { type: "string", description: "YYYY-MM-DD" },
        return_date: { type: "string", description: "YYYY-MM-DD, omit for one-way" },
      },
      required: ["origin", "destination", "depart_date"],
    },
  },
  {
    name: "get_deals",
    description: "Get current cheap flight deals from an origin airport, optionally filtered to a destination.",
    input_schema: {
      type: "object",
      properties: {
        origin: { type: "string", description: "Origin airport IATA code" },
        destination: { type: "string", description: "Destination airport IATA code — include it when the user asks about deals to a specific place" },
      },
      required: ["origin"],
    },
  },
  {
    name: "get_article",
    description:
      "Find TravelPlanInfo guide articles relevant to a destination or topic. Only recommend TPI's own articles this way.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "surprise_me",
    description:
      "Get real popular flight routes/destinations from an origin airport, for a user who wants an open-ended destination suggestion rather than a specific one. Call this for 'surprise me' / 'where should I go' style requests.",
    input_schema: {
      type: "object",
      properties: { origin: { type: "string", description: "Origin airport IATA code" } },
      required: ["origin"],
    },
  },
];

/**
 * Human-facing domain of each live tool. help-content.guard.test.ts derives the
 * set of things help copy may say "Atlas searches" from THIS map, so removing a
 * tool without updating help copy fails the build instead of shipping a promise
 * the assistant cannot keep.
 */
export const TOOL_DOMAIN: Record<string, string> = {
  search_flights: "flight",
  get_deals: "deal",
  get_article: "guide",
  surprise_me: "destination",
};

type ToolInput = Record<string, unknown>;

export interface RunAtlasTurnParams {
  message: string;
  history: MessageParam[];
  pageContext?: string;
  preferencesJson?: string;
  memoryContext?: string;
}

function stringInput(input: ToolInput, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.type === "tool_use";
}

function hasErrorFlag(result: unknown): boolean {
  return Boolean(result && typeof result === "object" && "is_error" in result && (result as { is_error?: unknown }).is_error);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeTool(name: string, input: ToolInput): Promise<unknown> {
  switch (name) {
    case "search_flights": {
      const origin = parseIata(stringInput(input, "origin"));
      if (!origin) {
        return {
          flights: [],
          no_data: true,
          reason: INVALID_IATA_REASON,
          origin: "",
          destination: stringInput(input, "destination"),
          airports_searched: [],
          destinations_searched: [],
        };
      }
      return renderSearchFlightsToolResult(await searchFlights(
        origin,
        stringInput(input, "destination"),
        stringInput(input, "depart_date"),
        stringInput(input, "return_date") || undefined
      ));
    }
    case "get_deals": {
      const origin = parseIata(stringInput(input, "origin"));
      if (!origin) {
        return { deals: [], no_data: true, reason: INVALID_IATA_REASON };
      }
      return renderDealsToolResult(
        await getDeals(origin, stringInput(input, "destination") || undefined),
        origin,
        stringInput(input, "destination") || undefined
      );
    }
    case "get_article":
      return getArticleTool(stringInput(input, "query"));
    case "surprise_me": {
      const origin = parseIata(stringInput(input, "origin"));
      if (!origin) {
        return { suggestions: [], no_data: true, reason: INVALID_IATA_REASON };
      }
      return renderSurpriseToolResult(await getSurpriseDestinations({ origin }));
    }
    default:
      return { is_error: true, error: `Unknown tool: ${name}` };
  }
}

const TOOL_TIMEOUT_MS = 30_000;

async function* streamTextAsTokens(text: string): AsyncGenerator<string> {
  const words = text.split(" ");
  for (let i = 0; i < words.length; i += 1) {
    const token = i === 0 ? words[i] : ` ${words[i]}`;
    yield encodeSseData(token);
    await sleep(10);
  }
}

async function executeToolSafely(name: string, input: ToolInput): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${TOOL_TIMEOUT_MS / 1000}s`)),
        TOOL_TIMEOUT_MS
      );
    });
    return await Promise.race([executeTool(name, input), timeout]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `Tool ${name} failed: ${message}`, is_error: true };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function* runAtlasTurn(params: RunAtlasTurnParams): AsyncGenerator<string> {
  try {
    // Check-then-act can race under concurrent requests; this mirrors the Python backend behavior at expected traffic volume.
    if (isSpendCapReached()) {
      yield 'data: {"error": "Atlas has reached its monthly usage limit. Please try again next month."}\n\n';
      yield DONE_FRAME;
      return;
    }

    const client = new Anthropic({ apiKey: getAnthropicApiKey() });
    const systemPrompt = buildAtlasSystemPrompt({
      pageContext: params.pageContext,
      preferencesJson: params.preferencesJson,
      memoryContext: params.memoryContext,
    });
    const currentMessages: MessageParam[] = [
      ...params.history,
      { role: "user", content: params.message },
    ];

    for (let iteration = 0; iteration <= MAX_TOOL_ITERATIONS; iteration += 1) {
      const useTools = iteration < MAX_TOOL_ITERATIONS;
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: "disabled" },
        system: useTools ? systemPrompt : `${systemPrompt}\n\nIMPORTANT: Respond with text only. Do not use any tools.`,
        messages: currentMessages,
        tools: TOOLS,
        ...(useTools ? {} : { tool_choice: { type: "none" as const } }),
      });

      recordAssistantSpend(MODEL, {
        inputTokens: response.usage.input_tokens ?? 0,
        outputTokens: response.usage.output_tokens ?? 0,
      });

      if (useTools && response.stop_reason === "tool_use") {
        // Stream any preamble text the model wrote alongside its tool calls —
        // it is part of the assistant's visible reply.
        for (const block of response.content) {
          if (block.type !== "text" || !block.text) continue;
          yield* streamTextAsTokens(block.text);
        }

        const toolResults: ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (!isToolUseBlock(block)) continue;
          const result = await executeToolSafely(block.name, block.input as ToolInput);
          yield `data: [TOOL:${block.name}]${JSON.stringify(result)}\n\n`;
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
            is_error: hasErrorFlag(result),
          });
        }

        currentMessages.push({ role: "assistant", content: response.content });
        currentMessages.push({ role: "user", content: toolResults });
        continue;
      }

      const textBlocks = response.content.filter(
        (block): block is Extract<ContentBlock, { type: "text" }> =>
          block.type === "text" && Boolean(block.text)
      );

      if (
        response.stop_reason === "max_tokens" &&
        response.content.some(isToolUseBlock) &&
        textBlocks.length === 0
      ) {
        // Cut off while assembling a tool call, with nothing streamable —
        // "cut short" is the accurate message, not a refusal.
        yield CUTOFF_FRAME;
        yield DONE_FRAME;
        return;
      }

      if (response.stop_reason === "refusal" || textBlocks.length === 0) {
        yield REFUSAL_FRAME;
        yield DONE_FRAME;
        return;
      }

      for (const block of textBlocks) {
        yield* streamTextAsTokens(block.text);
      }

      if (response.stop_reason === "max_tokens" && response.content.some(isToolUseBlock)) {
        // The model was cut off while assembling a tool call that will never run.
        yield CUTOFF_FRAME;
      }

      yield DONE_FRAME;
      return;
    }

    yield DONE_FRAME;
  } catch (error) {
    console.error("Anthropic tool loop failed:", error);
    yield ERROR_FRAME;
    yield DONE_FRAME;
  }
}
