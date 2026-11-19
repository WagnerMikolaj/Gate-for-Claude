# Weryfikacja dostawy — 19.11.2026

## Zakończone

- `npm test`: **34/34 testy**, bez pominiętych. Testy HTTP uruchomione na loopback; podpisane JWT testowego IdP podlegają rzeczywistej weryfikacji kryptograficznej. Połączenia do IdP/Claude są zastąpione odpowiedziami testowymi.
- `npm run check` oraz `node --check` dla wszystkich modułów serwera i kodu panelu: poprawna składnia.
- Parser PowerShell dla generatora App Control: brak błędów składni. Generator nie został wykonany i nie aktywował polityki na tej maszynie.
- `docker compose -f deploy/compose.yaml config --no-env-resolution --quiet`: poprawna struktura Compose; nie wczytywano produkcyjnych sekretów i nie uruchamiano kontenerów.
- Instalacja zależności z lockfile; npm zgłosił 0 znanych podatności w zainstalowanych pakietach w momencie instalacji. Nie jest to audyt bezpieczeństwa całego systemu.
- Przeglądarka: uruchomienie lokalnego demo, sesja ACME, zablokowanie syntetycznej wiadomości `confidential: syntetyczny plan testowy`, widoczna kategoria poufności, nieaktywny przycisk wysyłania do Claude, wpis DLP_BLOCKED w audycie organizacji bez treści wiadomości.

## Niepotwierdzone live

- Firmowe SSO, MFA/Conditional Access i blokowanie tożsamości osobistych przez rzeczywistego IdP.
- Dostępność modelu, klucze, billing i Tenant Restrictions na kontach Claude organizacji.
- Deployment kontenerów, Nginx/TLS, Squid/egress oraz firewall/MDM/App Control na urządzeniach. Docker Desktop Linux Engine na tej maszynie nie był uruchomiony; nie wykonano builda ani testów runtime kontenerów.
- Pełne pokrycie semantycznego DLP, celowej obfuskacji i wszystkich kanałów innych usług AI. Filtr wzorców nie stanowi gwarancji wykrycia każdej informacji wrażliwej.

Nie ustawiono systemowych blokad ani produkcyjnych kont. Lista wymaganego odbioru infrastruktury znajduje się w `DEPLOYMENT.md`.
