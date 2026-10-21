# content/queued/

Scheduled TravelPlanInfo articles wait here between `tpi_publisher.py --schedule`
and their go-live tick. The site reads only `content/articles/` (`src/lib/articles.ts`),
so nothing in this directory renders, enters `generateStaticParams`, or appears in
the sitemap — committing this directory can never publish an article early.

At go-live `tpi_schedule_runner.materialize()` moves `<slug>.json` to
`content/articles/`, stamps `date`/`modified` with the go-live time, and
`deploy_tpi.sh` stages the move. Cancelling a schedule deletes the file.
