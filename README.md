# Tenant Invoice

Static React/TypeScript client with Supabase PostgreSQL, Auth, RLS, Edge Functions, and logo Storage.

## Local setup

1. Copy `.env.example` to `.env.local` and add the Supabase URL and publishable key.
2. Install dependencies with `npm install`.
3. Run tests with `npm test`.
4. Start development with `npm run dev`.
5. Build shared-host files with `npm run build`; upload the contents of `dist`.

## Architecture

- `domain`: business rules with no React or Supabase dependencies.
- `application`: use cases and repository/service interfaces.
- `infrastructure`: Supabase and external-service adapters.
- `presentation`: React components and routes.
- `shared/container.ts`: composition root that wires implementations to interfaces.

Dependencies point inward: infrastructure and presentation may depend on application/domain, but domain never depends on frameworks.
