# Wdrożenie i odbiór

## Wybrany wariant: wyłącznie brama

Nie udostępniaj pracownikom równoległego Claude Web/Desktop/API. Zatwierdzony klient to panel Gate. Bezpośrednie usługi AI, CLI i aplikacje są blokowane przez MDM/App Control i polityki sieciowe. Nie wystarczy rozszerzenie przeglądarki, lista nazw procesów, plik hosts, PAC ani ustawienie SSO w samej bramie.

## Wymuszenie na urządzeniach

Preferowany profil dla ścisłej izolacji: dedykowany zarządzany segment/VDI z allowlistą aplikacji i egress. Dla Windows zastosuj App Control for Business przez Intune/GPO lub zatwierdzony system MDM. Odbierz użytkownikom lokalne uprawnienia admina i możliwość usunięcia profilu, zmiany routingu, instalowania VPN/proxy, uruchamiania przenośnych klientów i niezatwierdzonych przeglądarek. Sam zakaz pliku `Claude.exe` da się ominąć; potrzebna jest polityka allowlisty z egzekwowaniem.

`deploy/windows/New-GateAppControlPolicy.ps1` generuje XML i CIP z bazą Windows oraz hashami aplikacji z kuratorowanego katalogu referencyjnego. **Nie instaluje polityki.** Uruchom w administracyjnej sesji Windows PowerShell z ConfigCI na referencyjnym komputerze:

```powershell
.\deploy\windows\New-GateAppControlPolicy.ps1 -ApprovedApplicationDirectory C:\GateReference\Approved -OutputDirectory C:\GateReference\Policies\Pilot -Mode Audit
```

Najpierw rozdystrybuuj profil Audit do grupy pilotażowej. Sprawdź logi CodeIntegrity, wymagane aplikacje, interpreterów, sterowniki i procedurę odzyskiwania. Uwzględnij zalecane przez Microsoft reguły blokujące narzędzia obchodzące App Control oraz wpływ innych istniejących polityk. Dopiero zatwierdzoną politykę w trybie Enforced podpisz i wdroż przez MDM. Sam generator nie zapewnia kompletnej polityki dla konkretnej floty; nie został wykonany na komputerze użytkownika. Zmiany binariów wymagają aktualizacji reguł hash. Zatwierdzony Node/Python/PowerShell nadal może wykonywać niezatwierdzone skrypty — polityka skryptów i sieć są niezbędne.

## Sieć komputerów

Na firewallu/VPN/SWG: outbound default deny dla segmentu AI; tylko firmowe proxy/DNS/NTP i niezbędna infrastruktura. Zablokuj bezpośredni IPv4/IPv6 Internet, QUIC/UDP 443, zewnętrzne DNS/DoH/DoT, tunele i hotspoty według profilu urządzenia. Wymuś always-on VPN/proxy także poza biurem i fail-closed przy utracie agenta. Zakres tych reguł musi uwzględniać rzeczywiste usługi firmy, więc nie są automatycznie instalowane na tym komputerze.

`deploy/workstation-proxy.conf.example` to restrykcyjny wzorzec dla dedykowanego segmentu AI/VDI: CONNECT tylko na 443 do Gate i jawnie dopuszczonych endpointów logowania. Podmień adresację/host i dopasuj endpointy IdP do środowiska. Dla zwykłych stacji z szerokim dostępem do WWW potrzebny jest firmowy SWG/CASB z kontrolą aplikacji/usług AI i proxy/remote-browser; denylista kilku domen nie zapewni wymuszenia „cała praca AI przez Gate”.

Pracownik **nie może dotrzeć do proxy egress kontenera Gate**. Nie publikuj portu 3128 i nie używaj tego proxy jako proxy dla stacji roboczych, bo umożliwiłoby bezpośrednie wywołania API z pominięciem DLP.

## Stack serwera

1. Osobny utwardzony serwer Linux, aktualny Docker/Compose, dysk z szyfrowaniem, dostęp administracyjny ograniczony do operatorów.
2. Skonfiguruj `.env` i `tenants.local.json` jak w README. Sekrety powinny pochodzić z vaulta; unikaj ich w obrazie, repo, argumentach procesów i logach. Ustaw klucz HMAC audytu jako trwały sekret.
3. Zamontuj certyfikat/key w `deploy/tls/fullchain.pem` i `privkey.pem`; dopasuj nazwę w `nginx.conf` i `GATE_ORIGIN`. Przy niestandardowym porcie uwzględnij go w konfiguracji Host reverse proxy. Przykład zakłada 443.
4. Dopasuj `gateway-egress.conf` do dokładnych hostów discovery/token/JWKS każdego IdP. Dla Entra przykład dopuszcza `login.microsoftonline.com`. Inni dostawcy mogą używać osobnych hostów. Nie dopuszczaj wildcard całego Internetu. Przeprowadź `squid -k parse` w docelowym obrazie.
5. `docker compose -f deploy/compose.yaml config` następnie `docker compose -f deploy/compose.yaml up --build -d`. Nie loguj wyniku `compose config` do publicznych systemów, bo może zawierać sekrety z `.env`.
6. Gate ma wyłącznie sieć Docker `internal`; edge ma dostęp wejściowy, a Squid oddzielny outbound. Włączone `NODE_USE_ENV_PROXY=1` prowadzi fetch/OIDC przez allowlistę Squid. Brak proxy oznacza błąd i brak alternatywnego bezpośredniego ruchu.
7. Wolumen audytu musi być zapisywalny dla UID 1000 (`node`). Kontenery mają ograniczone zasoby i read-only filesystem poza audytem/tmp. Monitoruj zapełnienie dysku. Healthcheck TCP potwierdza proces, nie gotowość SSO ani dostawcy.
8. Przypnij zatwierdzone wersje/digesty obrazów i przeskanuj je przed rolloutem. Dostarczone tagi są przykładami utrzymywanych gałęzi, nie zatwierdzonymi artefaktami organizacji.

Kontenery nie zostały w tym środowisku uruchomione. Zanim uznasz izolację za działającą, zweryfikuj rzeczywisty routing, DNS, TLS, allowlistę egress, restart, backup WAL i uprawnienia wolumenów na docelowym hoście.

## Testy odbiorowe — wymagane w środowisku firmy

| Scenariusz | Oczekiwany wynik | Status dostawy |
| --- | --- | --- |
| Zatwierdzony użytkownik ACME z Gate.User | Sesja ACME, wyłącznie klucz/polityka ACME | Kod + lokalne testy OIDC; realny IdP do sprawdzenia |
| Prywatne konto bez roli, konto innego tenanta | Odmowa dostępu | Lokalne testy tokenów; realne loginy do sprawdzenia |
| Wybór BETA i login ACME | Brak sesji BETA | Lokalna walidacja tenant claim; live do sprawdzenia |
| Podmiana tenant ID/nagłówków/URL/modelu/klucza | Odmowa lub zignorowana niezaufana tożsamość | Testy HTTP |
| Wklejenie danych testowych z PESEL/sekretem/etykietą | 422, zero wywołań dostawcy | Testy DLP i HTTP |
| Załącznik/obraz/tool/system prompt klienta | 400, brak forward | Testy schematu |
| Awaria zapisu audytu | 503, zero wywołań dostawcy | Test HTTP |
| Audyt BETA z query tenant=ACME | Wyłącznie zdarzenia BETA | Test HTTP |
| Pracownik bez Gate.Admin | Brak odczytu audytu | Test HTTP |
| Claude Web/Desktop/Code i własny API key z komputera | Blokada uruchomienia i/lub sieci przed wysłaniem | Wymaga wdrożenia App Control/SWG |
| Zmiana proxy/VPN/DoH/QUIC/IPv6/portable browser | Brak obejścia Gate | Wymaga testów urządzeń/sieci |
| Zły UUID organizacji lub prywatny klucz w kontrolowanym teście operatora | Odmowa dostawcy przez Tenant Restrictions | Nie testowano live |
| Wyłączone/zepsute proxy egress | Brak wysyłania; brak fallback do Internetu | Do testu kontenerów/firewalla |
| Poprawna wiadomość z firmowym kluczem | Audyt → dostawca → filtr odpowiedzi → użytkownik | Dostawca lokalnie zastąpiony test double; live do sprawdzenia |

Do testów używaj wyłącznie danych syntetycznych i kont testowych. Po wyłączeniu roli w IdP sprawdź czas propagacji i wygaśnięcia sesji; w pilotażu restart Gate unieważnia wszystkie sesje. Wydanie do produkcji wymaga zakończonego odbioru powyższych kontroli, nie samego zielonego wyniku testów kodu.

## Tenant Restrictions

Anthropic dokumentuje nagłówek `anthropic-allowed-org-ids` dla Enterprise i organizacji Console; proxy musi nadpisywać nagłówek i usuwać jego warianty kontynuacji pochodzące od klienta. Mechanizm jest dostępny także dla web/desktop/OAuth/API, ale w tym projekcie używany tylko na wyjściu serwera API. Nie otwieraj bezpośredniego Claude Web/Desktop tylko dlatego, że Tenant Restrictions blokują konta prywatne — ten ruch omijałby filtr Gate.

Źródła: [Anthropic](https://support.claude.com/en/articles/13198485-enforce-network-level-access-control-with-tenant-restrictions), [App Control: tworzenie polityki](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/design/create-appcontrol-policy-for-fully-managed-devices), [New-CIPolicy](https://learn.microsoft.com/en-us/powershell/module/configci/new-cipolicy), [zalecane blokady aplikacji](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/design/applications-that-can-bypass-appcontrol), [Squid access control](https://www.squid-cache.org/Doc/config/http_access/), [Node proxy](https://nodejs.org/learn/http/enterprise-network-configuration).
