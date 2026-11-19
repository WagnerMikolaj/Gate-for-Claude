# Gate — firmowa brama AI, multi-tenant

Działająca implementacja pilotażowa firmowego dostępu do Claude. Cała praca z AI odbywa się przez serwer Gate: **SSO organizacji → polityka danych → audyt → firmowy klucz Claude**. Tenant jest wyprowadzany z sesji po weryfikacji tokenu IdP, nigdy z nagłówka ani treści żądania.

**Status:** kod i lokalne testy, bez wdrożenia blokad na komputerach/sieci firmy. Demo nie łączy się z Claude. Produkcja wymaga konfiguracji rzeczywistych organizacji i akceptacji testów infrastruktury. Filtr wzorców nie gwarantuje wykrycia wszystkich poufnych informacji.

Pełny opis projektu z diagramami: [architektura, bezpieczeństwo i wdrożenie (PDF, 19 stron)](output/pdf/Gate_Projekt_Architektura_i_Wdrozenie.pdf).

## Uruchom lokalnie

Wymagany Node.js >= 24.14.

```powershell
npm ci --ignore-scripts
npm test
npm run demo
```

Otwórz `http://127.0.0.1:8080`. Wybierz ACME lub BETA i otwórz demo. Przycisk „Sprawdź lokalnie” uruchamia rzeczywisty filtr serwerowy. Przykład blokady: `confidential: plan operacyjny`. Przykład przejścia: `Wyjaśnij działanie kolejki zadań`.

Demo: syntetyczne sesje, audyt w pamięci, dostęp wyłącznie przez loopback, brak wysyłania do dostawcy, niezależnie od zmiennych konfiguracji produkcyjnej. Nigdy nie publikuj demo przez reverse proxy/tunel.

## Co zostało zaimplementowane

- Oddzielna konfiguracja IdP, organizacji Claude, kluczy API, modelu, polityki i limitów dla każdego tenanta. Konfiguracja od operatora, bez publicznego onboardingu firm i bez przełączania tenanta w API.
- OIDC Authorization Code + PKCE, state, nonce, weryfikacja podpisu JWT, issuer/audience/expiry przez `openid-client`; dodatkowo zgodność claimu tenanta i wymaganej roli. Domena e-mail nie nadaje dostępu. Brak logowania kluczem osobistym.
- Sesje po stronie serwera: losowy identyfikator, cookie `__Host-`, HttpOnly, Secure w produkcji, SameSite=Lax, CSRF i ścisła kontrola Origin/Host. Limit bezczynności 15 min; czas całkowity najwyżej godzina lub ważność tokenu. Wylogowanie unieważnia sesję.
- DLP przed wysłaniem całej historii tekstowej, także wiadomości assistant: PESEL, Luhn dla kart, modulo 97 dla IBAN, e-mail, numery, typowe sekrety, etykiety poufności i długie kodowane ciągi. Normalizacja Unicode i usuwanie znaków niewidocznych. Polityka blokuje całe żądanie, nie wysyła wykrytej wartości do modelu. Także odpowiedź podlega kontroli przed wyświetleniem.
- Tylko tekst i jeden ustalony endpoint Claude Messages. Odrzucanie plików, obrazów, narzędzi, system promptów klienta, własnych URL, modeli, tenantów i kluczy. Brak pobierania plików/stron i wykonywania narzędzi.
- Metadane audytowe SQLite, pseudonim użytkownika HMAC z osobnym zakresem tenanta, łańcuch HMAC sprawdzany przy starcie, transakcyjny zapis przed wysłaniem. Awaria audytu zatrzymuje wysyłanie. Audyt odczytuje wyłącznie administrator własnego tenanta. Brak treści rozmów, sekretów, surowych błędów dostawcy i wartości wykrytych przez DLP.
- Wyłączony egress domyślnie, limity rozmiaru/czasu/ruchu, brak przekierowań dostawcy, bez renderowania HTML/Markdown odpowiedzi. Klucze są tylko po stronie serwera.

## Uruchomienie produkcyjne

1. Przeczytaj [architekturę i granice ochrony](docs/ARCHITECTURE.md) oraz [wdrożenie i testy odbiorowe](docs/DEPLOYMENT.md).
2. Skopiuj `.env.example` do `.env`, a `config/tenants.example.json` do `tenants.local.json`. Ustaw `GATE_TENANTS_FILE=./tenants.local.json` dla uruchomienia bez kontenerów. Zastąp **wszystkie przykładowe** identyfikatory i nazwy organizacji. Sekrety pobieraj z firmowego vaulta; `.env` służy do pilotażu.
3. Dla każdej firmy zarejestruj aplikację OIDC u jej IdP. Zarejestruj callback `https://<host-bramy>/auth/callback`, nadaj pracownikom `Gate.User`, administratorom dodatkowo `Gate.Admin`. Dla Entra użyj single-tenant issuer z konkretnym tenant ID; ogranicz gości/personalne tożsamości u IdP i włącz wymagane MFA oraz zgodność urządzeń. Claimy muszą być emitowane w podpisanym ID tokenie.
4. Przygotuj osobny klucz organizacji Claude na tenanta i poprawny UUID organizacji Console. Nie używaj prywatnych kluczy. Dostępność wybranego modelu potwierdź na kontach firmowych.
5. Wdróż wymuszony routing przez bramę, kontrolę uruchamianych aplikacji, TLS i sieciowy egress. Kontenery: `docker compose -f deploy/compose.yaml up --build -d` po przygotowaniu `.env`, konfiguracji tenantów i certyfikatów `deploy/tls/`. Reverse proxy i `GATE_ORIGIN` muszą mieć tę samą nazwę hosta.
6. Pozostaw `GATE_ALLOW_EXTERNAL_AI=false` do czasu odbioru SSO i blokad obejścia. Następnie operator włącza kontrolowany dostęp i przeprowadza test z firmowym kluczem.

`npm start` uruchamia tryb produkcyjny; niekompletna konfiguracja zatrzymuje start. Brak automatycznego przełączenia produkcji w demo. Nie zmieniono ustawień Windows ani kont użytkownika na tej maszynie.

## Struktura

| Ścieżka | Zastosowanie |
| --- | --- |
| `src/` | Serwer Node.js, SSO, DLP, klient Claude i audyt |
| `public/` | Lokalny panel użytkownika i audytu |
| `config/tenants.example.json` | Rejestr polityk i odwołań do sekretów tenantów |
| `deploy/compose.yaml` | Gate w sieci wewnętrznej + TLS edge + proxy egress z allowlistą |
| `deploy/workstation-proxy.conf.example` | Restrykcyjny wzorzec proxy dla wydzielonego segmentu AI/VDI |
| `deploy/windows/` | Generator artefaktów polityki App Control; bez aktywacji na komputerze |
| `test/security.test.mjs` | Testy granic bezpieczeństwa, OIDC z podpisanymi JWT i testy HTTP |

## Ograniczenia pilotażu

Ta wersja to **jedna instancja serwera** i logiczna izolacja tenantów. Sesje/limity są w pamięci i znikają po restarcie, co unieważnia sesje. Nie uruchamiaj wielu replik bez centralnego magazynu sesji i limitów. Baza audytu i klucz HMAC muszą przetrwać restart; utrata klucza uniemożliwia weryfikację historii. Kopie bazy wykonuj przez spójny backup SQLite, uwzględniając WAL.

Wspólny proces widzi sekrety tenantów; dla wymaganej separacji fizycznej uruchom osobną instancję, vault i bazę dla każdej firmy. Rola odebrana u IdP może obowiązywać w istniejącej sesji do jej wygaśnięcia; incydent wymaga też unieważnienia sesji Gate (w pilotażu restartu instancji). HMAC wykrywa zmianę zapisanych rekordów, ale bez zewnętrznych checkpointów/SIEM nie wykrywa usunięcia końca historii ani przywrócenia starszej kopii. Ustal retencję, szyfrowanie dysku i procedury backupu przed wdrożeniem.

Filtr ma celowo konserwatywne reguły i może blokować zwykłe numery lub e-maile. Nie zastępuje klasyfikacji dokumentów, enterprise DLP, kontroli urządzeń ani blokady innych usług AI. Claude pozostaje zewnętrznym dostawcą: jeśli dane w ogóle nie mogą opuścić infrastruktury, pozostaw egress wyłączony lub wdroż zatwierdzony model lokalny zamiast Claude API.

Dokumentacja źródłowa: [Anthropic Tenant Restrictions](https://support.claude.com/en/articles/13198485-enforce-network-level-access-control-with-tenant-restrictions), [OIDC client](https://github.com/panva/openid-client), [Microsoft App Control](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/), [Node proxy](https://nodejs.org/learn/http/enterprise-network-configuration). Dokumentację sprawdzono 19.11.2026. Testy lokalne nie potwierdzają działania usług firmowych ani konfiguracji infrastruktury.
