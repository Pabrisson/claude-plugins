# Panoramax (recorded: 2026-11-06)

- `api.json`: `GET https://api.panoramax.xyz/api` (the catalog, used by `doctor --network`).
- `48.8565,2.352.json`: `GET /api/search?place_position=2.352,48.8565&place_distance=0-150&limit=100` → the 100 STAC features sent (822 KB; CC-BY-SA pictures, 8 within 150 m).
- `45.9012,2.7021.json`: invented (the demo's fictional place).

## Rewritten fields (personal data)

`providers[].name`, `properties["geovisio:producer"]`, `exif["Exif.Image.Artist"]` and `exif["Exif.Image.Copyright"]` → `EXEMPLE Prénom`; `exif["Exif.Photo.BodySerialNumber"]` → `XXXXXXXXXXXXXX` (same length); an e-mail address of a contributor → `exemple@example.org`; a user folder in the digiKam history `/Users/<name>` → `/Users/exemple`.
