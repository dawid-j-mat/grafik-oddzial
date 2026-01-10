# Grafik Oddział

Starter projektu w Next.js (TypeScript, App Router) przygotowany do dalszej integracji z Supabase.

## Wymagania

- Node.js 18+ (zalecane LTS)
- npm

## Uruchomienie lokalnie (Windows)

W katalogu repozytorium uruchom kolejno:

```bash
npm install
npm run dev
```

Aplikacja będzie dostępna pod adresem: `http://localhost:3000`.

## Supabase Cloud Setup

### Dane dostępowe

1. Wejdź w panel Supabase → wybierz projekt.
2. Przejdź do **Project Settings → API**.
3. Skopiuj **Project URL** oraz **anon public** key do `.env.local` na podstawie `.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Wdrożenie migracji do Supabase Cloud

```bash
supabase login
supabase link --project-ref <ref>
supabase db push
```

### Uruchomienie aplikacji

```bash
npm install
npm run dev
```

## Kolejne kroki

1. Uzupełnij `.env.local` na podstawie `.env.example`.
2. Wykonaj migracje do Supabase Cloud przez `supabase db push`.
3. Przejdź do `/debug-db`, aby zweryfikować role i RPC.
