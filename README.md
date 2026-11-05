# ReStart — od praznog lokala do novog posla

Prototip: prazni gradski poslovni prostori (Zagreb) → usporedba lokacija → računica pokrivanja troškova.

## Pokretanje
```bash
python3 -m http.server 5180   # u mapi projekta
```
Otvori http://localhost:5180

## Tok (3 koraka)
1. **Ideja** — odaberi djelatnost, raspon površine i prioritete. Prostori izvan uvjeta se isključuju, ostali se rangiraju.
2. **Usporedba** — do 3 kandidata, svaka ocjena ima vidljiv razlog (površina, ZET, gustoća četvrti, položaj) + što nije potvrđeno.
3. **Računica** — klizači za zakupninu, uređenje, plaće… → koliko jedinica posla mjesečno treba za pokriće fiksnih troškova, te prijelomna točka („ako zakupnina A prijeđe X €/m², B postaje povoljniji").

## Podaci
| Datoteka | Izvor | Napomena |
|---|---|---|
| `data/spaces.json` | Grad Zagreb, *Prazni poslovni prostori 2024.* (data.zagreb.hr / data.gov.hr), original u `data/izvor-…-2024.csv` | 186 zapisa, 186 geokodirano preko OSM Nominatim; „evidentiran kao prazan" ≠ „dostupan danas" |
| `data/stops.json` | Grad Zagreb geoportal — autobusna (1888) i tramvajska (260) stajališta ZET-a | blizina ≠ prolaznost |
| `DISTRICTS` u `app.js` | DZS Popis 2021., konačni rezultati (obrada Grad Zagreb, tablica 8) | kontekst četvrti, ne broj kupaca |
| zakupnina po zoni, troškovi, marža | **pretpostavke** | ilustrativno, korisnik ih mijenja |

## Demo video
`ReStart-demo.mp4` (1:26). Ponovno snimanje (aplikacija mora raditi na :5180):
```bash
cd tools/demo-video && npm install && npx playwright install chromium && npm run record
```
