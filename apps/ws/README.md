# ws

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run dev
```

Set `JWT_SECRET` to the same value used by the API server and provide `DATABASE_URL` for board membership checks.
The frontend connects to WebSocket port `5000`. If you change the server's `WS_PORT`, update the port in the frontend board connection to match.

This project was created using `bun init` in bun v1.4.0. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
