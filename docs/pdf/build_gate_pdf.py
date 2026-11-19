"""Generate the project's Polish architecture report with vector diagrams.
Run with the bundled Python runtime. No external service or AI API is used.
"""
from pathlib import Path
from html import escape
import json
import math
import hashlib

from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output' / 'pdf'
TMP = ROOT / 'tmp' / 'pdfs'
OUT.mkdir(parents=True, exist_ok=True)
TMP.mkdir(parents=True, exist_ok=True)
PDF = OUT / 'Gate_Projekt_Architektura_i_Wdrozenie.pdf'
for name, file in [('Regular', 'arial.ttf'), ('Bold', 'arialbd.ttf'), ('Italic', 'ariali.ttf')]:
    pdfmetrics.registerFont(TTFont('Gate' + name, str(Path('C:/Windows/Fonts') / file)))
pdfmetrics.registerFontFamily('GateRegular', normal='GateRegular', bold='GateBold', italic='GateItalic', boldItalic='GateBold')

W, H = A4
M = 42
CW = W - 2*M
INK = HexColor('#172D24')
GREEN = HexColor('#195D42')
DARK = HexColor('#102B20')
MUTED = HexColor('#586F63')
LINE = HexColor('#D8E2DA')
PAPER = HexColor('#F5F8F4')
PALE = HexColor('#E9F1E5')
LIME = HexColor('#BCE299')
RED = HexColor('#A23D32')
RED_BG = HexColor('#FCF0EC')
AMBER = HexColor('#8B621D')
AMBER_BG = HexColor('#FCF5E6')
BLUE = HexColor('#315A79')
BLUE_BG = HexColor('#EDF3F8')
TOTAL = 19
c = canvas.Canvas(str(PDF), pagesize=A4, pageCompression=1)
c.setTitle('Gate - projekt architektury, bezpieczeństwa i wdrożenia')
c.setAuthor('Projekt Gate')
c.setCreator('Gate - generator dokumentacji projektu')
c.setSubject('Multi-tenant corporate AI gateway for Claude: project architecture and implementation status')
c.setKeywords('Gate, Claude, multi-tenant, DLP, SSO, izolacja, architektura')
drawn = []

def rect(x, top, w, h, fill=white, stroke=None, r=8):
    c.setFillColor(fill)
    c.setStrokeColor(stroke or fill)
    c.setLineWidth(0.7)
    c.roundRect(x, H-top-h, w, h, r, fill=1, stroke=bool(stroke))

def para(text, x, top, w, size=10.3, color=INK, bold=False, leading=None, align=0):
    style = ParagraphStyle('p', fontName='GateBold' if bold else 'GateRegular', fontSize=size,
        leading=leading or size*1.43, textColor=color, spaceBefore=0, spaceAfter=0,
        alignment=align, allowWidows=0, allowOrphans=0)
    p = Paragraph(text, style)
    _, h = p.wrap(w, 1500)
    if top+h > (H-12 if top >= 800 else 792):
        raise ValueError(f'Overflow page {c.getPageNumber()}: {top+h:.1f}: {text[:80]}')
    p.drawOn(c, x, H-top-h)
    drawn.append({'page':c.getPageNumber(),'x':round(x,2),'top':round(top,2),'w':round(w,2),'h':round(h,2),'text':text})
    return top+h

def line(x1,t1,x2,t2,color=LINE,width=1,dash=None):
    c.saveState(); c.setStrokeColor(color); c.setLineWidth(width)
    if dash: c.setDash(*dash)
    c.line(x1,H-t1,x2,H-t2); c.restoreState()

def arrow(points, color=GREEN, dash=None, width=1.5):
    c.saveState(); c.setStrokeColor(color); c.setFillColor(color); c.setLineWidth(width)
    if dash: c.setDash(*dash)
    p=c.beginPath(); p.moveTo(points[0][0],H-points[0][1])
    for x,y in points[1:]:p.lineTo(x,H-y)
    c.drawPath(p)
    (x0,y0),(x1,y1)=points[-2:]
    ang=math.atan2(y1-y0,x1-x0)
    path=c.beginPath(); path.moveTo(x1,H-y1)
    for offset in [-0.47,0.47]:
        xx=x1-6*math.cos(ang+offset); yy=y1-6*math.sin(ang+offset)
        path.lineTo(xx,H-yy)
    path.close(); c.drawPath(path,stroke=0,fill=1); c.restoreState()

def label(text,x,top,w=120,color=MUTED,size=8):
    return para(text,x,top,w,size,color,leading=size*1.25)

def pill(text,x,top,color=GREEN,bg=PALE):
    size=7.6; width=pdfmetrics.stringWidth(text,'GateBold',size)+18
    rect(x,top,width,20,bg,r=4)
    para(text,x+9,top+5,width-16,size,color,bold=True,leading=9)
    return width

def node(x,top,w,h,title,body='',fill=white,border=LINE,color=INK,fs=10):
    rect(x,top,w,h,fill,border,r=7)
    if body:
        y=para(title,x+12,top+11,w-24,fs,color,bold=True,leading=fs*1.3)
        end=para(body,x+12,y+5,w-24,8.5,color,leading=11.5)
    else:
        # Center short single-line nodes without arbitrary text clipping.
        end=para(title,x+10,top+max(10,(h-fs*1.4)/2),w-20,fs,color,bold=True,leading=fs*1.3,align=1)
    if end>top+h-5:raise ValueError(f'Node overflow page {c.getPageNumber()}: {title} {end} > {top+h}')

def callout(top,title,body,kind='green',height=None):
    fg,bg={'green':(GREEN,PALE),'amber':(AMBER,AMBER_BG),'red':(RED,RED_BG),'blue':(BLUE,BLUE_BG)}[kind]
    textw=CW-32
    style=ParagraphStyle('measure',fontName='GateRegular',fontSize=9.8,leading=14)
    p=Paragraph(body,style); _,ph=p.wrap(textw,1000)
    ht=height or (ph+51)
    rect(M,top,CW,ht,bg,r=7)
    para(title,M+16,top+12,textw,10,fg,bold=True)
    para(body,M+16,top+34,textw,9.8,fg,leading=14)
    return top+ht

def bullets(items,x,top,w,size=10.2,gap=9):
    y=top
    for item in items:
        c.setFillColor(GREEN);c.circle(x+3,H-y-6.5,2,fill=1,stroke=0)
        y=para(item,x+14,y,w-14,size,leading=size*1.4)+gap
    return y

def table(top,widths,rows,header=True,size=9.1):
    normal=ParagraphStyle('cell',fontName='GateRegular',fontSize=size,leading=size*1.35,textColor=INK)
    head=ParagraphStyle('head',parent=normal,fontName='GateBold',textColor=GREEN)
    cells=[[Paragraph(str(v),head if i==0 and header else normal) for v in row] for i,row in enumerate(rows)]
    t=Table(cells,colWidths=widths,hAlign='LEFT')
    commands=[('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9),('LINEBELOW',(0,0),(-1,-1),0.5,LINE)]
    if header:commands += [('BACKGROUND',(0,0),(-1,0),PALE)]
    for i in range(1 if header else 0,len(rows)):
        if i%2==0:commands.append(('BACKGROUND',(0,i),(-1,i),PAPER))
    t.setStyle(TableStyle(commands)); _,th=t.wrap(CW,1000)
    if top+th>789:raise ValueError(f'Table overflow page {c.getPageNumber()}: {top+th:.1f}')
    t.drawOn(c,M,H-top-th)
    return top+th

def section(k,title,subtitle='',state='PROJEKT GATE'):
    n=c.getPageNumber()
    c.bookmarkPage(f'p{n}')
    c.addOutlineEntry(title,f'p{n}',level=0,closed=False)
    c.setFillColor(PAPER);c.rect(0,0,W,H,fill=1,stroke=0)
    para('gate.',M,26,80,18,GREEN,bold=True)
    para('ARCHITEKTURA / BEZPIECZEŃSTWO / WDROŻENIE',M+100,33,CW-100,7.3,MUTED,align=2)
    line(M,58,W-M,58)
    pill(state,M,77)
    para(k,M,109,30,10,GREEN,bold=True)
    para(title,M+33,104,CW-33,23,bold=True,leading=27)
    if subtitle:para(subtitle,M,145,CW,10.4,MUTED,leading=15)

def footer(source=''):
    if source:para(source,M,770,CW,7.1,MUTED,leading=9)
    line(M,799,W-M,799)
    para('GATE  |  0.1.0  |  19.11.2026',M,810,270,7.5,MUTED)
    para(f'{c.getPageNumber():02d} / {TOTAL}',W-M-65,810,65,8,MUTED,align=2)
    c.showPage()

# 01 - cover
c.bookmarkPage('p1');c.addOutlineEntry('Gate - dokument projektowy','p1',level=0)
c.setFillColor(PAPER);c.rect(0,0,W,H,fill=1,stroke=0)
c.setFillColor(DARK);c.rect(0,H-435,W,435,fill=1,stroke=0)
for x in range(380,590,30):line(x,30,x,410,HexColor('#1B3B2C'),.5)
for top in range(30,420,30):line(370,top,590,top,HexColor('#1B3B2C'),.5)
para('gate.',M,39,180,30,LIME,bold=True)
pill('DOKUMENT PROJEKTOWY',M,100,LIME,HexColor('#254834'))
para('Firmowa brama AI',M,147,CW,35,white,bold=True,leading=41)
para('Architektura multi-tenant<br/>dla kontrolowanego dostępu do Claude',M,199,CW,20,white,leading=28)
para('Jedna zatwierdzona droga do modelu.<br/>Tożsamość organizacji, kontrola danych i audyt<br/>przed przekroczeniem granicy infrastruktury.',M,277,440,11.7,HexColor('#C1D8CA'),leading=18)
for x,title,body in [(M,'SSO','Firmowa tożsamość'),(M+174,'DLP','Kontrola przed egress'),(M+348,'AUDYT','Metadane bez treści')]:
    rect(x,369,163,43,HexColor('#234633'),r=6)
    para(title,x+12,378,140,10,LIME,bold=True)
    para(body,x+12,393,140,7.8,white,leading=9)
para('Założenie nadrzędne',M,471,CW,11,GREEN,bold=True)
para('Cała praca z AI przechodzi<br/>przez firmową bramę.',M,498,CW,27,bold=True,leading=34)
para('Bezpośredni Claude Web, Desktop, Code i prywatne klucze API nie są kanałem pracy pracownika. Wymuszenie tej zasady wymaga współpracy aplikacji, sieci i zarządzania urządzeniami.',M,581,CW,11,MUTED,leading=17)
for x,big,small in [(M,'Multi-tenant','Osobne polityki i tożsamości'),(M+174,'34 / 34','Lokalne testy zakończone'),(M+348,'Pilot','Wdrożenie firmowe przed nami')]:
    rect(x,673,163,71,white,LINE)
    para(big,x+12,686,139,18,GREEN,bold=True)
    para(small,x+12,717,139,7.6,MUTED,leading=10)
footer('Stan implementacji: 19.11.2026. Dokument opisuje pilot oraz wymagania docelowego wdrożenia.')

# 02 - reader guide
section('01','Mapa projektu','Dokument łączy perspektywę biznesową, architekturę techniczną i warunki odbioru.')
toc=[('03','Cel, wymagania i zakres'),('04','Architektura całego systemu'),('05','Komponenty i kontrakt API'),('06','Model izolacji tenantów'),('07','Firmowe logowanie SSO'),('08','Przepływ wiadomości i decyzji'),('09','Kontrola danych DLP'),('10','Sieć i topologia wdrożenia'),('11','Komputery i zakaz obejścia bramy'),('12','Cykl danych i audyt'),('13','Zabezpieczenia aplikacji i limity'),('14','Model zagrożeń i ryzyko'),('15','Wdrożenie oraz onboarding firmy'),('16','Eksploatacja i odpowiedzialność'),('17','Weryfikacja i testy odbiorowe'),('18','Dalsze prace i decyzje'),('19','Słownik i źródła projektu')]
for i,(page,title) in enumerate(toc):
    top=194+i*22
    para(page,M,top,35,9.4,GREEN,bold=True)
    para(title,M+40,top,CW-40,9.8)
    c.linkRect('',f'p{int(page)}',(M,H-top-16,W-M,H-top+2),relative=0,thickness=0)
callout(594,'Jak czytać statusy','<b>KOD + TESTY</b> oznacza zachowanie zaimplementowane i sprawdzone lokalnie. <b>DO WDROŻENIA</b> oznacza wymagane działania u klienta. <b>ROZWÓJ</b> opisuje rozszerzenia, których pilot jeszcze nie zawiera.',height=93)
para('Założenia i zakres dokumentu',M,711,CW,10.5,bold=True)
para('ACME i BETA to fikcyjne organizacje demonstracyjne. Windows/Entra/Intune to dostarczony wariant referencyjny; rzeczywisty IdP, MDM i topologia firmy nie zostały wskazane. Nie przedstawiamy pilota jako działającej ochrony floty.',M,735,CW,9.2,MUTED,leading=13)
footer()

# 03 - scope
section('02','Cel, wymagania i zakres','Ograniczamy ryzyko wycieku danych przez prywatne konta AI na komputerach firmowych.')
y=table(191,[76,265,170],[['ID','Wymaganie','Sposób realizacji'],
['R1','Jedyny zatwierdzony kanał AI to Gate.','Routing + SWG/firewall + panel Gate.'],
['R2','Prywatne konto nie uzyskuje dostępu do pracy firmowej.','Przypięty IdP, tenant claim i rola; osobny firmowy klucz Claude.'],
['R3','Wykryte dane wrażliwe są zatrzymane przed modelem.','Serwerowy DLP przed każdym wywołaniem.'],
['R4','Firmy nie wybierają ani nie widzą kontekstu innej firmy.','Tenant z sesji, osobna konfiguracja i odczyt audytu w zakresie firmy.'],
['R5','Niedozwolone aplikacje nie mogą stać się drogą obejścia.','Allowlista aplikacji + polityka skryptów + kontrola sieci.'],
['R6','Decyzje są rozliczalne bez utrwalania treści.','Minimalny audyt metadanych przed egress.']],size=9.3)
y+=24
para('Zakres obecnej wersji',M,y,CW,13,bold=True)
y=bullets(['Panel tekstowy i serwer API; jedna instancja Gate, wiele firm w rejestrze konfiguracji.','SSO OIDC, regułowy DLP, klient Claude Messages, audyt SQLite, przykłady deploymentu i generator polityki App Control.','Bez plików, obrazów, narzędzi, MCP i integracji pobierających dane z firmowych systemów.'],M,y+28,CW,10.2,gap=10)
callout(y+10,'Warunek osiągnięcia celu','Aplikacja Gate zatrzymuje wykryte dane na swoim kanale. Dopiero wdrożone blokady urządzeń i sieci powodują, że użytkownik nie może wybrać kanału omijającego tę kontrolę.','amber')
footer('Podstawa: README.md; docs/ARCHITECTURE.md; docs/DEPLOYMENT.md.')

# 04 - context
section('03','Architektura całego systemu','Rozdzielamy komputer pracownika, firmową bramę i zewnętrznego dostawcę modelu.',state='ARCHITEKTURA DOCELOWA')
rect(M,194,CW,176,BLUE_BG,LINE)
label('STREFA URZĄDZEŃ FIRMOWYCH - DO WDROŻENIA',M+14,206,CW-28,BLUE,8)
node(58,238,150,81,'Komputer / VDI','Zarządzana przeglądarka<br/>Brak lokalnego admina')
node(270,238,264,81,'Proxy / SWG + firewall','Wymuszona trasa do Gate<br/>Blokada usług AI poza bramą')
arrow([(208,278),(270,278)])
rect(M,398,CW,189,PALE,LINE)
label('STREFA BRAMY - KOD PILOTA + KONFIGURACJA WDROŻENIA',M+14,409,CW-28,GREEN,8)
node(58,442,115,88,'TLS edge','Nginx<br/>HTTPS / 443')
node(209,442,178,88,'Gate','Sesja i tenant<br/>Walidacja + DLP + role')
node(423,442,111,88,'Audyt','Metadane<br/>SQLite / HMAC')
arrow([(173,486),(209,486)])
arrow([(387,486),(423,486)])
arrow([(402,319),(402,383),(535,383),(535,430),(115,430),(115,442)])
rect(M,619,CW,109,white,LINE)
label('DOSTAWCY ZEWNĘTRZNI - KONTROLOWANY EGRESS',M+14,630,330,MUTED,8)
node(58,655,204,54,'Firmowy IdP','Tożsamość pracownika',fs=9.5)
node(326,655,208,54,'Claude API','Firmowy klucz i organizacja',fs=9.5)
arrow([(254,530),(254,604),(50,604),(50,647),(160,647),(160,655)],BLUE,dash=(4,3))
arrow([(341,530),(341,598),(430,598),(430,655)])
para('Linia zielona: kontrolowana ścieżka wiadomości. Linia przerywana: komunikacja uwierzytelniania. Połączenia Gate do dostawców przechodzą przez dedykowane proxy egress (szczegóły na str. 10).',M,743,CW,8.7,MUTED,leading=12)
footer('Sam serwer Gate nie zmienia routingu ani uprawnień komputerów pracowników.')

# 05 - components
section('04','Komponenty i kontrakt API','Jedna aplikacja Node.js z rozdzielonymi modułami odpowiedzialności.',state='KOD + TESTY')
y=table(190,[133,218,160],[['Komponent','Odpowiedzialność','Plik / technologia'],
['Panel użytkownika','Logowanie, edytor tekstu, wynik DLP, audyt administratora.','public/ - HTML, CSS, JS'],
['HTTP / polityka API','Sesja, CSRF, schema, limity, decyzja i orkiestracja.','src/server.mjs'],
['Tożsamość','OIDC, sesje, PKCE/state/nonce, role firmy.','src/auth.mjs<br/>openid-client'],
['Reguły i konfiguracja','Rejestr firm, odwołania do sekretów, skanowanie tekstu.','src/config.mjs<br/>src/dlp.mjs'],
['Dostawca / audyt','Stały endpoint Claude; zapis metadanych i HMAC.','src/provider.mjs<br/>src/audit.mjs']],size=9)
para('Minimalna powierzchnia API',M,y+23,CW,13,bold=True)
y=table(y+48,[175,336],[['Endpoint','Dostęp i znaczenie'],
['GET /auth/login/{tenant}','Rozpoczęcie SSO w skonfigurowanej organizacji.'],
['GET /auth/callback','Jednorazowy callback związany z przeglądarką.'],
['GET /api/session','Sesja: tenant, CSRF, rola i jawna polityka.'],
['POST /api/check','Lokalny skan; bez wywołania Claude.'],
['POST /api/chat','Skan, audyt, firmowe API i kontrola odpowiedzi.'],
['GET /api/events','Ostatnie 50 zdarzeń własnej firmy; wymaga Gate.Admin.'],
['POST /auth/logout','Unieważnienie sesji po stronie serwera.']],size=8.6)
para('Pomocniczo: /healthz (proces) i /api/bootstrap (publiczne nazwy firm). /auth/demo/{tenant} działa wyłącznie w lokalnym trybie demonstracyjnym. Klient nie wysyła tenant ID, klucza, modelu ani URL dostawcy w kontrakcie czatu.',M,y+17,CW,9,MUTED,leading=13)
footer('Podstawa: src/server.mjs; package.json. Node.js >= 24.14.0; biblioteka openid-client.')

# 06 - tenancy
section('05','Model izolacji tenantów','Firma jest granicą polityki i tożsamości. W pilotażu separacja pozostaje logiczna.',state='KOD + TESTY / GRANICE IZOLACJI')
for top,name,fill,items in [(202,'ACME',PALE,['IdP ACME + role','Polityka ACME','Klucz Claude ACME','Audyt ACME']),(345,'BETA',BLUE_BG,['IdP BETA + role','Polityka BETA','Klucz Claude BETA','Audyt BETA'])]:
    rect(M,top,CW,116,fill,LINE)
    para(name,M+15,top+13,110,12,GREEN if name=='ACME' else BLUE,bold=True)
    for i,item in enumerate(items):node(M+15+i*122,top+47,113,49,item,fs=8.8)
line(M+17,333,W-M-17,333,RED,1.1,dash=(3,3))
label('BRAK WYBORU CUDZEGO TENANTA W ŻĄDANIU API',M+67,323,CW-100,RED,7.7)
node(M,491,CW,63,'Wspólny runtime Gate + wspólna baza audytu','Tenant jest przypisany w sesji serwera; zapytanie audytu jest ograniczone do tenant ID.',fill=white,fs=11)
arrow([(M+CW/2,461),(M+CW/2,491)])
y=bullets(['Konfiguracja każdej firmy zawiera osobny issuer/client ID, claim tenanta, wymagane role, politykę, referencję sekretu i organizację Claude.','Podmiana nagłówka, query string lub pól JSON nie przenosi użytkownika do innej firmy. Niezatwierdzone pola czatu są odrzucane.','Sekrety OIDC oraz aktywne klucze Claude muszą być różne per tenant. Nazwy firm w publicznym katalogu są jawną metadaną pilota.'],M,579,CW,9.7,gap=9)
callout(y+7,'Dla wyższej izolacji','Osobna instancja Gate, baza, vault, klucze szyfrowania i egress dla każdej firmy. Wspólny proces pilota ma dostęp do konfiguracji wszystkich tenantów; nie jest to fizyczna separacja.','amber')
footer('Podstawa: src/config.mjs; src/auth.mjs; src/audit.mjs; docs/ARCHITECTURE.md.')

# 07 - sso sequence
section('06','Firmowe logowanie SSO','Prywatny e-mail nie jest uprawnieniem. Liczy się zweryfikowana tożsamość oraz rola.',state='KOD + TESTY OIDC')
xs=[98,230,362,494]
for x,t in zip(xs,['Przeglądarka','Gate','IdP firmy','Audyt']):
    node(x-51,196,102,41,t,fs=8.8)
    line(x,238,x,539,LINE,.8,dash=(3,3))
def seq(y,a,b,text):
    arrow([(xs[a],y),(xs[b],y)],GREEN if a<=b else BLUE,width=1.2)
    x=min(xs[a],xs[b])+7
    label(text,x,y-26,abs(xs[a]-xs[b])-14,INK,8)
seq(268,0,1,'1. Wybór firmy')
seq(305,1,0,'2. Redirect / PKCE')
seq(342,0,2,'3. Przekierowanie i logowanie firmowe')
seq(379,2,0,'4. Powrót z kodem i state')
seq(416,0,1,'5. Callback z kodem')
seq(453,1,2,'6. Kod + verifier')
seq(490,2,1,'7. ID token')
node(180,525,200,60,'Weryfikacja w Gate','Podpis, issuer, audience, czas,<br/>nonce, claim firmy oraz role',fill=PALE,fs=10)
arrow([(230,490),(230,525)])
arrow([(380,553),(494,553),(494,594),(380,594)])
label('8. LOGIN_ALLOWED',390,532,120,GREEN,7.8)
label('9. Sesja po udanym zapisie audytu',M,621,CW,GREEN,9)
arrow([(230,585),(230,646),(98,646)],GREEN,width=1.2)
y=table(674,[132,379],[['Uprawnienie','Zasada'],['Gate.User','Wymagane do utworzenia sesji i korzystania z AI.'],['Gate.Admin','Dodatkowo do Gate.User; odczyt audytu własnej firmy.']],size=9)
footer('MFA, zgodność urządzenia oraz wykluczenie kont osobistych/niezatwierdzonych gości ustala IdP firmy.')

# 08 - request flow
section('07','Przepływ wiadomości','Każda droga do Claude przechodzi kontrolę treści i trwały zapis decyzji.',state='KOD + TESTY')
cx=194; nw=220; bx=443; bw=110
steps=[(196,'1. Sesja + tenant + CSRF','Brak sesji lub niezgodny Origin: odmowa.'),
       (284,'2. Walidacja i DLP','Cała dostarczona historia; tylko tekst.'),
       (372,'3. Audyt przed wysłaniem','FORWARD_AUTHORIZED zatwierdzone w bazie.'),
       (460,'4. Firmowy Claude API','Klucz, organizacja i model z konfiguracji.'),
       (548,'5. DLP odpowiedzi','Brak bezpośredniego renderowania HTML.'),
       (636,'6. Wynik + audyt','REPLY_DELIVERED; tekst do przeglądarki.')]
for i,(top,title,body) in enumerate(steps):
    node(cx,top,nw,66,title,body,fill=PALE if i in [1,2] else white,fs=10)
    if i<len(steps)-1:arrow([(cx+nw/2,top+66),(cx+nw/2,steps[i+1][0])])
for top,title,body in [(284,'422 / blokada','Wykryte dane'),(372,'503 / stop','Audyt lub egress'),(548,'422 / blokada','Wrażliwa odpowiedź')]:
    node(bx,top+3,bw,60,title,body,fill=RED_BG,border=HexColor('#E5C9C2'),color=RED,fs=8.6)
    arrow([(cx+nw,top+33),(bx,top+33)],RED,width=1.1)
rect(M,196,128,506,BLUE_BG,r=7)
para('ZASADA<br/>FAIL-CLOSED',M+13,213,102,11,BLUE,bold=True,leading=16)
para('Brak autoryzacji, błąd polityki, niedostępny audyt lub wyłączony egress nie otwierają drogi zastępczej do dostawcy.',M+13,273,102,9.5,BLUE,leading=14)
line(M+13,409,M+115,409,HexColor('#C9D7E2'))
para('Kontrola lokalna',M+13,430,102,10,BLUE,bold=True)
para('/api/check kończy się po skanie i zapisie wyniku. Nie wywołuje Claude.',M+13,465,102,9.5,BLUE,leading=14)
para('Filtr odpowiedzi działa po przetworzeniu przez dostawcę. Nie cofa wcześniejszego egress. Błąd lub timeout dostawcy nie dowodzi, że żądanie do niego nie dotarło.',M,725,CW,9.5,MUTED,leading=14)
footer('Podstawa: src/server.mjs; src/provider.mjs; test/security.test.mjs.')

# 09 - dlp
section('08','Kontrola danych DLP','Lokalne reguły deterministyczne - bez wysyłania treści do modelu klasyfikującego.',state='KOD + TESTY / DLP REGUŁOWY')
y=table(191,[125,214,172],[['Kategoria','Mechanizm pilota','Granica / uwaga'],
['PESEL','Wzorzec 11 cyfr i suma kontrolna.','Nie jest pełną walidacją dokumentu/tożsamości.'],
['Karty / IBAN','Luhn dla kart; modulo 97 dla IBAN.','Celowo ostrożne blokowanie długich numerów.'],
['E-mail / numery','Wzorce adresów i ciągów cyfr/telefonów.','Możliwe fałszywe alarmy dla danych publicznych.'],
['Sekrety','Typowe klucze API, klucze prywatne i przypisania haseł/tokenów.','Nie każdy format sekretu jest rozpoznawany.'],
['Poufność','Lista blokowanych fraz per tenant.','Nie rozumie automatycznie każdej tajemnicy biznesowej.'],
['Kodowanie','Konserwatywne wzorce długich ciągów kodowanych.','Brak pełnej odporności na celową obfuskację.']],size=9.1)
para('Kolejność przetwarzania',M,y+24,CW,13,bold=True)
tops=y+53
for i,(title,body) in enumerate([('Normalizacja','Unicode NFKC<br/>Znaki niewidoczne'),('Skan historii','User + assistant<br/>Także połączenia treści'),('Decyzja','Kategorie bez wartości<br/>Całe żądanie odrzucone')]):
    x=M+i*174;node(x,tops,163,82,title,body,fill=white,fs=10)
    if i<2:arrow([(x+163,tops+41),(x+174,tops+41)],width=1)
callout(tops+109,'Co oznacza wynik „nie wykryto”','Oznacza brak dopasowania do zdefiniowanych wzorców, a nie potwierdzenie, że treść jest publiczna. Przed produkcją potrzebne są firmowa klasyfikacja informacji, ocena jakości reguł i decyzja o dodatkowym DLP.','amber')
footer('Podstawa: src/dlp.mjs. Dane testowe powinny być syntetyczne; detekcje nie wracają z wykrytą wartością.')

# 10 - networks
section('09','Sieć i topologia wdrożenia','Kontener Gate nie ma własnego bezpośredniego wyjścia do Internetu w dostarczonym wzorcu.',state='KONFIGURACJA / DO TESTÓW RUNTIME')
node(M,198,150,70,'Stacja firmowa','Wymuszone proxy / SWG<br/>HTTPS do panelu')
node(239,198,139,70,'Edge / Nginx','Port 443<br/>Certyfikat firmowy')
arrow([(192,233),(239,233)])
rect(M,300,CW,235,PALE,LINE)
label('DOCKER: ISOLATED / INTERNAL: TRUE',M+14,313,CW-28,GREEN,8)
node(72,355,167,80,'Gate / Node.js','Tylko sieć wewnętrzna<br/>Brak publikacji portu 8080')
node(317,355,188,80,'Proxy egress / Squid','CONNECT tylko na 443<br/>Lista dopuszczonych hostów')
arrow([(309,268),(309,285),(535,285),(535,342),(155,342),(155,355)])
arrow([(239,395),(317,395)])
node(72,463,167,49,'Wolumen audytu',fs=9.2)
arrow([(155,435),(155,463)])
rect(M,572,CW,108,BLUE_BG,LINE)
label('SIEĆ OUTBOUND - TYLKO PROXY EGRESS',M+14,585,CW-28,BLUE,8)
node(66,611,210,48,'api.anthropic.com',fs=10)
node(316,611,210,48,'Dokładne hosty IdP / JWKS',fs=9.2)
arrow([(411,435),(411,602),(170,602),(170,611)])
arrow([(411,602),(421,602),(421,611)])
para('Brak proxy oznacza błąd, bez ścieżki awaryjnej do publicznego API. Nie wolno publikować portu proxy egress ani udostępniać go pracownikom - umożliwiłoby to ominięcie DLP.',M,704,CW,10.1,RED,leading=15)
footer('Podstawa: deploy/compose.yaml; deploy/nginx.conf; deploy/gateway-egress.conf. Runtime kontenerów niezweryfikowany.')

# 11 - endpoint enforcement
section('10','Komputery i zakaz obejścia','Zablokowanie prywatnego kanału wymaga egzekwowania polityki poza serwerem Gate.',state='DO WDROŻENIA U KLIENTA')
layers=[('Urządzenie','MDM, brak lokalnego administratora, ochrona profilu i aktualizacje.'),
('Uruchamianie aplikacji','App Control: allowlista zatwierdzonych binariów, polityka skryptów i interpreterów.'),
('Sieć także poza biurem','Always-on routing / VDI, default deny, firmowy DNS; kontrola VPN, QUIC i IPv6.'),
('Dozwolony kanał','Panel Gate + niezbędne endpointy firmowego logowania.'),
('Kontrola w Gate','Firmowa sesja, polityka DLP, audyt oraz klucz organizacji Claude.')]
for i,(title,body) in enumerate(layers):
    top=194+i*83
    rect(M,top,CW,67,white if i%2==0 else PALE,LINE)
    pill(str(i+1).zfill(2),M+13,top+13)
    para(title,M+59,top+12,CW-74,11,bold=True)
    para(body,M+59,top+34,CW-74,9.5,MUTED,leading=13)
    if i<4:arrow([(M+CW/2,top+67),(M+CW/2,top+83)],width=1)
callout(626,'Generator polityki Windows: dostarczony artefakt','Skrypt tworzy XML/CIP z bazą Windows i hashami zatwierdzonych aplikacji. Nie instaluje polityki. Wymaga pilota Audit, przeglądu zdarzeń, procedury odzyskiwania oraz późniejszego wdrożenia Enforced przez MDM.','blue')
para('Denylista kilku domen, nazwa Claude.exe, PAC lub rozszerzenie przeglądarki nie zapewniają wymuszenia. Dla pełnej kontroli preferowany jest wydzielony segment AI/VDI lub odpowiednio zarządzany SWG.',M,735,CW,9.1,MUTED,leading=13)
footer('Podstawa: deploy/windows/New-GateAppControlPolicy.ps1; docs/DEPLOYMENT.md.')

# 12 - data lifecycle
section('11','Cykl danych i audyt','Treść służy obsłudze żądania. Rejestrowane są decyzje i kategorie, bez treści rozmowy.',state='KOD + TESTY / OPERACJE DO USTALENIA')
for x,title,body in [(M,'Treść żądania','Pamięć procesu Gate<br/>DLP lokalnie'),(M+174,'Audyt przed egress','Metadane bez treści<br/>SQLite + HMAC'),(M+348,'Dozwolony egress','Claude API<br/>Firmowy klucz tenanta')]:node(x,197,163,78,title,body,fill=white,fs=10)
arrow([(M+163,236),(M+174,236)])
arrow([(M+337,236),(M+348,236)])
y=table(302,[161,350],[['Pole audytu','Zawartość'],['tenant','Identyfikator organizacji (kolumna bazy).'],['at / requestId','Czas zdarzenia i identyfikator żądania.'],['actor','Pseudonim HMAC z tenant ID oraz subject użytkownika.'],['decision / categories','Np. DLP_BLOCKED i SECRET; bez dopasowanej wartości.'],['id / mac','Kolejność rekordu i łańcuch integralności HMAC.']],size=9.4)
para('Łańcuch integralności',M,y+25,CW,13,bold=True)
for i,title in enumerate(['Poprzedni MAC','Rekord + tenant + ID','Nowy MAC']):
    x=M+i*174;node(x,y+54,163,43,title,fill=PALE,fs=9)
    if i<2:arrow([(x+163,y+75),(x+174,y+75)],width=1)
para('Zapis transakcyjny z synchronous=FULL przed egress; łańcuch sprawdzany przy starcie. Zmiana rekordu powoduje odmowę uruchomienia. Administrator firmy widzi wyłącznie jej ostatnie 50 zdarzeń.',M,y+119,CW,10,leading=14.5)
callout(y+176,'Granice audytu i retencji','Łańcuch nie wykrywa samodzielnie usunięcia końca historii lub przywrócenia starszej kopii. Potrzebne są zewnętrzny SIEM/checkpoint, polityka retencji, szyfrowanie dysku i backup SQLite zgodny z WAL. Retencję po stronie Claude należy uzgodnić osobno.','amber')
footer('Podstawa: src/audit.mjs. Nie zapisujemy payloadu; nie oznacza to braku przetwarzania danych u dostawcy.')

# 13 - hardening
section('12','Zabezpieczenia i limity','Wartości implementacji pilota; nie są deklaracją wydajności produkcyjnej.',state='KOD + TESTY')
y=table(190,[183,328],[['Obszar','Bieżąca kontrola / limit'],
['Sesja i cookie','HttpOnly, Secure w produkcji, SameSite=Lax, __Host-; 15 min bezczynności; maks. 60 min lub ważność tokenu.'],
['OIDC','Podpis JWT, issuer/audience/expiry, nonce/state/PKCE; flow logowania wygasa po 5 min.'],
['HTTP i przeglądarka','Ścisły Host/Origin, token CSRF, CSP, HSTS, no-store, brak CORS i wyświetlania HTML modelu.'],
['Wejście JSON','64 000 bajtów request body; 48 000 bajtów łącznej treści; 12 000 znaków na wiadomość.'],
['Historia','Maksymalnie 20 elementów; naprzemienne user/assistant; pierwszy i ostatni user. Panel wysyła pojedynczą wiadomość.'],
['Ruch','Limit per tenant + subject z konfiguracji (przykład: 10/min); dodatkowy wspólny limit per adres połączenia.'],
['Współbieżność','Jedno aktywne wywołanie dostawcy na tenant + subject; maks. 100 łącznie w procesie.'],
['Dostawca','Stały HTTPS endpoint, bez redirect; timeout 30 s; max_tokens=1024; odpowiedź do 128 000 bajtów.'],
['Pojemność w pamięci','Do 10 000 sesji i 2 000 oczekujących flow SSO; restart unieważnia sesje i zeruje limity.']],size=9.1)
callout(y+22,'Ograniczenia skalowania','Pilot nie ma centralnego magazynu sesji, globalnych limitów między replikami ani osobnego harmonogramowania zasobów per firma. Za reverse proxy limit adresu połączenia może obejmować wielu użytkowników łącznie; przed skalowaniem wymaga przeprojektowania.','amber')
footer('Podstawa: src/auth.mjs; src/server.mjs; src/dlp.mjs; src/provider.mjs. Zakres do dalszego hardeningu na str. 18.')

# 14 - threats
section('13','Model zagrożeń i ryzyko','Mechanizmy aplikacji są tylko częścią ochrony całego środowiska.',state='MODEL ZAGROŻEŃ')
y=table(190,[130,210,171],[['Zagrożenie','Kontrola projektu','Ryzyko / wymagany odbiór'],
['Konto prywatne','Przypięty IdP + claim firmy + Gate.User; firmowy klucz Claude.','IdP musi ograniczać konta osobiste i niezaufanych gości.'],
['Zmiana organizacji','Tenant tylko z sesji serwera; brak wyboru w body i audycie.','Wspólny runtime/vault to granica zaufanego operatora.'],
['Wklejenie sekretu','Skan przed egress, skan historii i normalizacja.','Brak gwarancji dla dowolnej tajemnicy opisowej i obfuskacji.'],
['Własny klucz / endpoint','Ścisły schema; model, URL, klucz i org ustala serwer.','Sekrety wymagają vaulta oraz rotacji.'],
['Narzędzia i upload','Tylko tekst; odrzucanie plików, obrazów, tools i MCP.','Funkcje te wymagają osobnego projektu przed włączeniem.'],
['Obejście Gate','MDM/App Control, SWG i wymuszony egress.','Kontrole poza aplikacją nie są jeszcze wdrożone.'],
['Awaria audytu','Zapis przed wysłaniem; brak zapisu zatrzymuje forward.','Zapełnienie dysku, backup i odtwarzanie do odbioru.'],
['XSS / CSRF','CSP, tekstowe odpowiedzi, Origin/Host i CSRF.','Wymagane niezależne testy penetracyjne.'],
['Dostawca / timeout','Ograniczony egress, firmowa organizacja, błędy bez payloadu.','Timeout nie oznacza braku przetworzenia; brak auto-retry.']],size=8.8)
para('Poza granicą kontroli Gate',M,y+23,CW,13,bold=True)
para('Fotografowanie ekranu, ręczne przepisywanie informacji na urządzeniu prywatnym, złośliwy operator platformy oraz wszystkie niezarządzane kanały poza firmową infrastrukturą. Projekt wymaga również procesów organizacyjnych i kontroli fizycznych adekwatnych do ryzyka.',M,y+49,CW,10,MUTED,leading=14)
footer('Ocena jakościowa projektu, bez deklaracji certyfikacji, zgodności regulacyjnej lub pełnej odporności.')

# 15 - rollout
section('14','Wdrożenie i onboarding firmy','Uruchomienie produkcyjne następuje po odbiorze infrastruktury, tożsamości i polityki.',state='PLAN WDROŻENIA')
items=[('1. Uzgodnienie środowiska','Wyznacz właściciela danych, IdP/MDM/SWG, model dostępu i klasyfikację informacji. Ustal granice tenantów i wymagany poziom separacji.'),
('2. Rejestracja tenanta','Osobny issuer/client ID i sekret OIDC; claim firmy; Gate.User/Gate.Admin; rejestracja callbacku; firmowa organizacja i klucz Claude.'),
('3. Konfiguracja serwera','Utwardzony host, TLS, trwały klucz audytu i wolumen; konfiguracja tylko do odczytu. Sekrety w vault; obrazy przypięte do zatwierdzonych wersji/digestów.'),
('4. Wymuszenie kanału','Firewall/SWG/default deny, routing poza biurem i ochrona przed obejściem. App Control: Audit, przegląd zdarzeń, potem zatwierdzony Enforced.'),
('5. Odbiór bez egress','GATE_ALLOW_EXTERNAL_AI=false. Testy SSO, izolacji, DLP, audytu, restartu oraz blokad bezpośredniego AI na urządzeniach.'),
('6. Kontrolowany pilot live','Operator włącza egress po akceptacji. Test z firmowym kluczem, błędną organizacją i dostępem osobistym; monitoring, rollback i decyzja o rollout.')]
for i,(title,body) in enumerate(items):
    top=192+i*87
    rect(M,top,CW,75,white if i%2==0 else PALE,LINE)
    para(title,M+14,top+11,CW-28,11,GREEN,bold=True)
    para(body,M+14,top+34,CW-28,9.5,leading=13.1)
para('Warunek zakończenia onboardingu: firma ma potwierdzone SSO, własny kontekst dostawcy, zaakceptowaną politykę i działającą blokadę obejścia. Sam wpis w rejestrze tenantów nie kończy wdrożenia.',M,730,CW,9.5,AMBER,leading=14)
footer('Podstawa: README.md; docs/DEPLOYMENT.md. Harmonogram zależy od środowiska i gotowości zespołów klienta.')

# 16 - ops
section('15','Eksploatacja i odpowiedzialność','Role operacyjne poniżej to propozycja do zatwierdzenia w organizacji.',state='MODEL OPERACYJNY DO UZGODNIENIA')
y=table(191,[129,210,172],[['Rola','Odpowiada za','Granica dostępu'],
['Operator platformy','Serwer, TLS, release, sekret audytu, backup i monitoring.','Zaufany dostęp do infrastruktury; brak osobnego panelu operatora w pilocie.'],
['Administrator firmy','IdP, role pracowników, MDM/SWG i odbiór kanału.','Gate.Admin daje odczyt audytu tylko swojej firmy.'],
['Właściciel danych / security','Klasyfikacja, reguły DLP, ryzyko, retencja i akceptacja produkcji.','Zmiany polityki poprzez kontrolowany proces operatora.'],
['Użytkownik','Praca w panelu z dozwolonymi treściami, zgłoszenie blokad.','Gate.User, bez klucza Claude i uprawnień zmiany polityk.']],size=9.1)
para('Podstawowe procedury reagowania',M,y+24,CW,13,bold=True)
y=table(y+50,[136,375],[['Zdarzenie','Działanie operacyjne'],
['Incydent konta','Odbierz rolę u IdP i unieważnij sesje Gate. Pilot: restart instancji unieważnia wszystkie sesje; bez selektywnego panelu revoke.'],
['Awaria audytu / dysku','Wstrzymaj egress, usuń przyczynę i sprawdź integralność. Nie obchodź wymogu audytu i nie kasuj historii w celu odblokowania.'],
['Kompromitacja klucza','Zablokuj egress, odwołaj i wymień właściwy klucz firmowy, sprawdź zdarzenia. Rotację HMAC zaplanuj z migracją/weryfikacją historii.'],
['Błąd dostawcy','Bez automatycznego ponawiania żądania; sprawdź request ID i status. Żądanie mogło zostać przetworzone po stronie dostawcy.']],size=8.9)
para('Monitoring do wdrożenia: dostępność, błędy SSO, stan wolumenu, błędy audytu, opóźnienia dostawcy, blokady DLP, koszty/limity per firma i próby obejścia. Healthcheck TCP potwierdza proces, nie gotowość całej ścieżki.',M,y+18,CW,9.2,MUTED,leading=13)
footer('Sesje i limity są w pamięci. Backup SQLite musi być spójny i uwzględniać tryb WAL oraz trwały klucz HMAC.')

# 17 - tests
section('16','Weryfikacja i odbiór','Rozróżniamy testy kodu od potwierdzenia ochrony w rzeczywistym środowisku firmy.',state='34 / 34 TESTY LOKALNE')
rect(M,195,CW,77,PALE,r=8)
para('34 / 34',M+17,207,135,29,GREEN,bold=True)
para('Testy automatyczne zakończone<br/>OIDC z podpisanymi JWT + DLP + HTTP + audyt',M+165,214,CW-180,10.7,GREEN,leading=17)
y=table(297,[139,225,147],[['Obszar','Potwierdzone lokalnie','Do odbioru live'],
['Tożsamość','Błędny podpis, issuer, audience, czas, nonce, tenant i role są odrzucane.','Rzeczywisty IdP, MFA, goście i konta osobiste.'],
['Izolacja firm','Próby podmiany kontekstu i odczytu cudzego audytu nie dają dostępu.','Konfiguracja tenantów i ról w organizacjach.'],
['Kontrola danych','Wzorce DLP; brak wywołania dostawcy po blokadzie; ścisły schema.','Jakość polityki dla danych i procesów firmy.'],
['Audyt','Trwałość, brak surowych wartości, HMAC i blokada przy awarii zapisu.','Backup/restore, retencja i zewnętrzny checkpoint.'],
['Panel / konfiguracje','Demo w przeglądarce; składnia JS i PowerShell; struktura Compose.','Kontenery, TLS, Squid i stan urządzeń.'],
['Dostawca','Stały endpoint/model/klucz; obsługa błędów i kontrola odpowiedzi.','Firmowy klucz, org restriction, model i realny billing.']],size=8.9)
callout(y+23,'Kryterium go-live','Wszystkie wymagane testy urządzeń, sieci i firmowego SSO muszą zostać odebrane, a odpowiedzialny właściciel zaakceptować ryzyko DLP. Nie ma podstaw do deklaracji, że firmowe komputery są już chronione.','amber')
footer('Źródło wyników: docs/VALIDATION.md; test/security.test.mjs. IdP i Claude w testach są kontrolowanymi zastępnikami.')

# 18 - roadmap
section('17','Dalsze prace i decyzje','Priorytety dotyczą przygotowania do produkcji, a nie rozszerzania zakresu bez odbioru.',state='ROZWÓJ / WARUNKI PRODUKCJI')
y=table(190,[63,251,197],[['Etap','Zakres','Warunek zakończenia'],
['P0','Podłączenie rzeczywistych tenantów, IdP, firmowych kluczy, TLS oraz odbiór routingu i App Control/SWG.','Udokumentowana blokada kont osobistych i kanałów poza Gate.'],
['P0','Jakość DLP, klasyfikacja informacji, polityka retencji i dopuszczenie zewnętrznego modelu.','Właściciel danych zatwierdza politykę i ryzyko resztkowe.'],
['P1','Trwałe sesje, selektywna revokacja i integracja ze zmianami uprawnień IdP.','Odebranie dostępu działa w uzgodnionym czasie.'],
['P1','Centralne limity, budżety kosztów, izolacja zasobów firm i monitoring.','Testy obciążenia i niezależne limity między replikami.'],
['P1','Vault z rotacją, spójny backup, SIEM/checkpoint oraz przegląd bezpieczeństwa.','Sprawdzone odtwarzanie, reakcja na incydent i testy penetracyjne.'],
['P2','Wyższa separacja: deployment i baza per tenant; dodatkowy DLP semantyczny/etykiety.','Potwierdzona izolacja i jakość na uzgodnionym zbiorze testów.']],size=9.1)
para('Decyzje potrzebne przed wdrożeniem',M,y+25,CW,13,bold=True)
bullets(['Jakie IdP, systemy urządzeń, MDM/SWG i środowisko serwerowe obsługuje każda firma?','Czy wystarcza logiczna izolacja, czy wymagany jest osobny deployment i vault dla firmy?','Jakie dane wolno przetwarzać u Claude, gdzie i jak długo mogą być przechowywane?','Kto zatwierdza reguły DLP, koszty, wyjątki, retencję i ostateczny odbiór produkcji?'],M,y+53,CW,10,gap=9)
footer('Wersja 0.1.0 jest pilotem. Brak obietnicy pełnej ochrony, certyfikacji, SLA lub gotowości wieloreplikowej.')

# 19 - glossary and sources
section('18','Słownik i źródła projektu','Podstawą dokumentu jest rzeczywisty kod i dokumentacja repozytorium na 19.11.2026.')
y=table(190,[101,410],[['Pojęcie','Znaczenie w projekcie'],
['Tenant','Organizacja z własną tożsamością, polityką i kontekstem Claude.'],
['IdP / SSO','Dostawca tożsamości i firmowe logowanie. OIDC jest protokołem integracji.'],
['DLP','Kontrola przepływu danych; w pilocie filtr zdefiniowanych wzorców.'],
['Egress','Wyjście danych z infrastruktury firmy do zewnętrznego dostawcy.'],
['MDM / SWG','Zarządzanie urządzeniami / firmowa kontrola ruchu WWW.'],
['Fail-closed','Błąd lub brak wymaganej kontroli zatrzymuje wysyłanie.']],size=9)
para('Dokumentacja projektu',M,y+22,CW,12.5,bold=True)
y=para('README.md; docs/ARCHITECTURE.md; docs/DEPLOYMENT.md; docs/VALIDATION.md; src/*.mjs; deploy/*; test/security.test.mjs. Wersja aplikacji: 0.1.0. Opracowanie nie zmienia konfiguracji urządzeń ani nie uruchamia usług produkcyjnych.',M,y+47,CW,9.5,MUTED,leading=13.5)
para('Odniesienia techniczne',M,y+23,CW,12.5,bold=True)
refs=[('Anthropic - Tenant Restrictions','https://support.claude.com/en/articles/13198485-enforce-network-level-access-control-with-tenant-restrictions'),('openid-client - biblioteka OIDC','https://github.com/panva/openid-client'),('Microsoft - App Control for Business','https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/'),('Node.js - enterprise network configuration','https://nodejs.org/learn/http/enterprise-network-configuration'),('Squid - kontrola dostępu','https://www.squid-cache.org/Doc/config/http_access/')]
yy=y+50
for title,url in refs:
    yy=para(f'<link href="{escape(url,quote=True)}" color="#195D42"><u>{escape(title)}</u></link>',M,yy,CW,9.5,leading=13.2)+9
para('Odniesienia dostawców służą konfiguracji integracji. Ich aktualną dostępność i działanie należy potwierdzić na kontach oraz infrastrukturze firmy. Opis działania kodu wynika z repozytorium; konfiguracje wdrożeniowe nie są potwierdzonym stanem produkcji.',M,yy+11,CW,9.3,MUTED,leading=13.3)
footer('Dokument: Gate - projekt architektury, bezpieczeństwa i wdrożenia. Koniec opracowania.')

if c.getPageNumber()-1 != TOTAL:raise ValueError('Wrong page count')
c.save()
(TMP/'layout.json').write_text(json.dumps(drawn,ensure_ascii=False,indent=2),encoding='utf-8')
hashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT/'README.md',ROOT/'docs/ARCHITECTURE.md',ROOT/'docs/DEPLOYMENT.md',ROOT/'docs/VALIDATION.md',*sorted((ROOT/'src').glob('*.mjs'))]}
(TMP/'source-manifest.json').write_text(json.dumps(hashes,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'pdf':str(PDF),'pages':TOTAL,'bytes':PDF.stat().st_size},ensure_ascii=False))
