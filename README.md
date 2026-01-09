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

## Kolejne kroki (bez wdrożeń Supabase)

1. Utwórz projekt w Supabase (panel webowy).
2. Skopiuj URL projektu oraz klucz anon do pliku `.env.local` na podstawie `.env.example`.
3. Dodaj klienta Supabase w aplikacji (np. w module `lib/supabaseClient.ts`).
4. Przygotuj schemat tabel oraz RLS zgodnie z zasadami z pliku `AGENTS.md`.

> Na tym etapie nie wdrażamy niczego do Supabase ani Dockera — to tylko przygotowana struktura projektu.
