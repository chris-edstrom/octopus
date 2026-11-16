Title: fix(cli): tell self-hosters when indexing fails for lack of embeddings

## Summary

Refs #933 (related bug 6).

`octp review --index` on a self-hosted install with no embeddings provider got a generic "HTTP 500 Indexing batch failed", fell back to bare mode and exited 0. The server knew the cause (no `OPENAI_API_KEY`, rejected Ollama URL, dimension mismatch) but only logged it.

The index-local route now returns the existing fixed embedding advice on self-hosted deployments and in development, where the caller is the operator who can fix it. Hosted production keeps the generic message, matching the review routes.

## Testing

- `embedding-advice.test.ts`: advice text per failure cause, and the generic message for hosted production.
- `local-index-embedding-advice` fixture: the route returns the advice when self-hosted and the generic text when hosted.
- Not exercised with the CLI against a live server.
