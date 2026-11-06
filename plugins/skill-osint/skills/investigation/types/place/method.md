# place — what stands at an address or a point, and how it changed

Read `references/cycle.md` first. This type is passive: it reads public services about a place and never contacts anyone there, and never follows a person to or from it. A home address is personal data: when the engine warns « is a home » and the frame says `person: false`, stop and ask the user for the frame (`status --set blocked --why …`). Ground images can show people: open them on their page, never save them, never zoom on a person.

## frame
The question (what is there, who is there, since when), the purpose, `noisy` (ask or never; this type has no noisy step) and, for someone's home, `person=true` with its legal basis. A city or a region is not a place for this type: ask for a street address or coordinates.

## collect
`osint.mjs place collect -p <slug>`: the point (the coordinates given, the point of the entity the case was opened from, or the geocoders), then OpenStreetMap around it, ground images, the companies registered within 150 m (France) and the imagery. A step that failed is in the Journal: run it again alone (`--only osm`). Without a Mapillary token that provider is skipped, said once in the Journal: Panoramax and KartaView still answer. When the engine warns that the two geocoders disagree, decide which point is right (both on the map; the street signs on the ground images) and move it with `collect --at lat,lon` — never a midpoint.

## process
Go through what was found, one item at a time: the building (its OpenStreetMap tags, the official address), the places with a name (Points of interest), the companies (open and closed), the ground images (Ground images, newest first). Record what you read yourself: `clue "…" --status observed` for what an image shows (a sign, works, a closed shutter), with the image's page kept as a source (`source <page> --file <capture>`); `read` for a text you can read in full. A point of interest's website and phone are already entities: pivot from them when the question needs it.

## analyse
Hypotheses per level: `identity` (what stands there, who occupies it today) and `history` (what it was, when it changed). List every candidate the sources name (the register, OpenStreetMap, the signs on the images) before choosing. `hyp lr` with each clue's true status: the register and the official address `read`; a sign on a dated image `observed`; OpenStreetMap's tags are only as recent as their last edit; a company's registered address is where it is domiciled, not always where it works (dozens of companies at one door is a domiciliation): only a sign, a dated image or the place's own site shows who works there.

## redteam
Try to refute the leading hypothesis: an old image (check its date), a domiciliation address, an OpenStreetMap object not updated, a geocoder that put the point on another street, a closed establishment still on the map, a ground image looking away from the place (check its bearing).

## conclude
`conclude --file`: one answer per level with its criteria, the dates of the images and records behind it, the alternatives with the test that would separate them.

## leads
`next --file`: pivots (`company-fr` on a company with its SIREN, `domain` on a point of interest's website, `phone` on its number, `verify-media` on a ground image to check where and when it was taken), a Refresh later (new ground images, new companies, OpenStreetMap edits), and `[place:history]` when the question is about change.

## ground-look
Open the ground images nearest to the point at full size, one at a time (their page on Mapillary, Panoramax or KartaView), newest first, and those whose bearing on the map looks towards the point. For each: what it shows that bears on the question (signs, shop fronts, works, door numbers), its date, licence and author. Record each finding as `clue … --status observed` with the image's page as its source; never describe an image you have not opened. Describe the place, never a person who happens to be in the picture.

## history
Compare the place across time: the IGN orthophotos of each period on the map (France: the Background selector, 1950-1965 to today), then the Esri Wayback releases (the Imagery table: links only, open them in a browser), the dates of the ground images (Timeline) and of the companies (openings, closings). Write each change as a dated clue (`observed` for imagery, `read` for the register) and one `history` hypothesis per scenario.
