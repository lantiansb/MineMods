# Studio AI developer service

This independent Node-compatible service calls only `https://api.openai.com/v1/responses`, with exact model `gpt-6-astra` and reasoning effort `high`. It never uses the legacy MineMods model router, another application's credentials, external CLIs, or model fallback.

Configure an independent `OPENAI_API_KEY` and a `STUDIO_SERVICE_TOKEN` in the server environment, then run `bun dev` from this package. The server binds `127.0.0.1:4319`; `STUDIO_SERVICE_PORT` can change the loopback port. Configure the same service token and URL in the trusted desktop main process through `createModelingClient({url, token})`. Never pass either service configuration or an OpenAI key to the renderer.

`POST /v1/modeling` accepts `Authorization: Bearer <service token>` and the strict JSON body `{step: "model" | "revise", content: string, revision: string}`. A successful result contains validated `design`, `revision`, `usage`, and exact-model `provenance`. `content` is the full design brief, including any prior design required for revision; this stateless preview does not retrieve project revisions itself.

The shared service token identifies `developer-preview`. It is a development integration mechanism, not completed product login, user identity, billing, entitlement checks or a persistent usage ledger. Production deployment requires those capabilities. Contexts are created inside the trusted service, never from client-provided budgets or identity fields.

Each route invocation permits one dispatch, at most 8192 output tokens and a 100000-token task budget. The boundary reserves a conservative UTF-8 input estimate plus output limit before dispatch; failed/unknown usage retains that reservation. Trusted contexts can permit up to three explicit dispatches, with no automatic retries. Cancellation and timeout close the context permanently. Usage/provenance are returned for persistence by the project layer; this preview service's quota ledger is in memory.

The V1 asset design is bounded geometry, six AI-authored solid colors per cube, and idle/walk/hurt animation rotation channels. It is an initial design contract, not a full pixel-texture synthesis or final art-quality claim.

Protocol acceptance is tested with local HTTP fixtures. Real GPT-6 access and structured-output compatibility must be independently verified with the configured server key; fixture success is not evidence of account/model access.
