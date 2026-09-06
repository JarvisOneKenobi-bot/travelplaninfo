// Article page under locale segment — full rendering lives here.
// The root src/app/[slug]/page.tsx re-exports this to avoid route duplication.
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { Metadata } from "next";
import Link from "next/link";
import { setRequestLocale } from "next-intl/server";
import Header from "@/components/Header";
import HelpButton from "@/components/HelpButton";
import ArticleHero from "@/components/ArticleHero";
import AffiliateSidebar from "@/components/AffiliateSidebar";
import AffiliateInlineCTA from "@/components/AffiliateInlineCTA";
import ArticleAffiliateCTA from "@/components/ArticleAffiliateCTA";
import FAQAccordion from "@/components/FAQAccordion";
import { getAllArticles, getArticle } from "@/lib/articles";
import { withSponsoredRel } from "@/lib/affiliate-rel";
import { routing } from "@/i18n/routing";

function stripH1(html: string): string {
  return html.replace(/<h1[^>]*>.*?<\/h1>/is, "");
}

function splitByH2(html: string): string[] {
  return stripH1(html).split(/(?=<h2[\s>])/i).filter((p) => p.trim().length > 0);
}

function decodeEntities(str: string): string {
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&hellip;/g, "…")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&nbsp;/g, " ");
}

interface Props {
  params: Promise<{ slug: string; locale: string }>;
}

// Generate static params for all articles × all locales
export async function generateStaticParams() {
  const articles = getAllArticles();
  return routing.locales.flatMap((locale) =>
    articles.map((post) => ({ locale, slug: post.slug }))
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, locale } = await params;
  const post = getArticle(slug);
  if (!post) return { title: "Post Not Found | TravelPlanInfo" };
  const description = decodeEntities(post.seo.description || post.excerpt);

  const base = "https://travelplaninfo.com";
  const localePath = locale === "en" ? "" : `/${locale}`;
  const url = `${base}${localePath}/${slug}/`;
  const languages = Object.fromEntries(
    routing.locales.map((loc) => [
      loc,
      `${base}${loc === "en" ? "" : "/" + loc}/${slug}/`,
    ])
  );

  return {
    title: post.seo.title || post.title,
    description,
    openGraph: {
      title: post.seo.title || post.title,
      description,
      type: "article",
      url,
      publishedTime: post.date,
      modifiedTime: post.modified,
      authors: ["TravelPlanInfo"],
      images: post.seo.ogImage ? [post.seo.ogImage] : [],
    },
    alternates: {
      canonical: locale === "en" ? post.seo.canonical || url : url,
      languages,
    },
  };
}

export default async function LocaleArticlePage({ params }: Props) {
  const { slug, locale } = await params;
  setRequestLocale(locale);

  const post = getArticle(slug);
  if (!post) notFound();

  const formattedDate = new Date(post.date).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const base = "https://travelplaninfo.com";
  const localePath = locale === "en" ? "" : `/${locale}`;
  const url = `${base}${localePath}/${slug}/`;
  const homeUrl = `${base}${localePath}/`;
  const guidesUrl = `${base}${localePath}/guides/`;

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: decodeEntities(post.title),
    datePublished: post.date,
    dateModified: post.modified,
    author: { "@type": "Organization", name: "TravelPlanInfo" },
    publisher: {
      "@type": "Organization",
      name: "TravelPlanInfo",
      url: base,
    },
    ...(post.featuredImage ? { image: `${base}${post.featuredImage}` } : {}),
    description: post.seo.description || post.excerpt,
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: homeUrl },
      { "@type": "ListItem", position: 2, name: "Guides", item: guidesUrl },
      { "@type": "ListItem", position: 3, name: post.title, item: url },
    ],
  };

  const faqSchema = post.faq?.length
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: post.faq.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      }
    : null;

  return (
    <>
      <Header />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      {faqSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        />
      )}
      {post.featuredImage ? (
        <ArticleHero
          title={post.title}
          excerpt={post.excerpt}
          featuredImage={post.featuredImage}
          date={post.date}
          formattedDate={formattedDate}
          category={post.categories?.[0]}
        />
      ) : (
        <div className="w-full px-6 pt-6">
          <nav className="text-sm text-gray-500 mb-4">
            <Link href="/" className="hover:text-orange-600 transition-colors">Home</Link>
            <span className="mx-2">/</span>
            <span className="text-gray-900">{post.categories?.[0]?.name || "Article"}</span>
          </nav>
          <h1 className="text-[2em] font-bold text-[#4b5563] mb-3 leading-tight">
            {post.title}
          </h1>
          <div className="flex items-center gap-4 text-sm text-gray-500 mb-6 pb-6 border-b border-gray-200">
            <time dateTime={post.date}>{formattedDate}</time>
            {post.categories && post.categories.length > 0 && (
              <>
                <span>&bull;</span>
                <span className="bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-xs font-medium">
                  {post.categories[0].name}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      <main className="w-full px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
          <div className="min-w-0">
            <article
              className="prose prose-lg prose-orange max-w-none
                prose-headings:font-bold prose-headings:text-[#4b5563]
                prose-h1:text-[2em]
                prose-p:text-gray-700 prose-p:leading-relaxed
                prose-a:text-orange-600 prose-a:no-underline hover:prose-a:underline
                prose-img:rounded-xl prose-img:shadow-md
                prose-ul:text-gray-700 prose-ol:text-gray-700
                prose-li:marker:text-orange-500
                prose-blockquote:border-l-orange-500 prose-blockquote:bg-orange-50 prose-blockquote:py-2 prose-blockquote:px-4 prose-blockquote:rounded-r-lg
                prose-strong:text-gray-900
                prose-code:text-orange-600 prose-code:bg-orange-50 prose-code:px-2 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
                prose-hr:border-gray-200"
            >
              {splitByH2(withSponsoredRel(post.content)).map((section, i) => (
                <Fragment key={i}>
                  <div dangerouslySetInnerHTML={{ __html: section }} />
                  {post.affiliateOpportunities.length > 0 && i > 0 && i % 2 === 0 && (
                    <ArticleAffiliateCTA
                      opportunities={post.affiliateOpportunities}
                      destination={post.search_location || post.categories?.[0]?.name}
                    />
                  )}
                </Fragment>
              ))}
            </article>

            <AffiliateInlineCTA />

            {post.faq && post.faq.length > 0 && (
              <FAQAccordion items={post.faq} />
            )}

            <div className="mt-8 pt-8 border-t border-gray-200">
              <Link
                href="/guides"
                className="inline-flex items-center gap-2 text-orange-600 hover:text-orange-700 font-medium transition-colors"
              >
                ← Back to all articles
              </Link>
            </div>
          </div>

          <div className="hidden lg:block">
            <div className="sticky top-8">
              <AffiliateSidebar />
            </div>
          </div>
        </div>
      </main>
      <HelpButton pageId="article" />
    </>
  );
}
