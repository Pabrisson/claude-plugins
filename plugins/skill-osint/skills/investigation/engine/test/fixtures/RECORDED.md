# Recorded answers (2026-11-06)

Real responses, asked with the User-Agent `skill-osint (fixtures)` for public subjects only (EDF, 1.1.1.1, 2606:4700:4700::1111, 172.66.157.237, 193.0.6.139, AS13335, example.org, example.com, the Hôtel de Ville de Paris), unmodified unless a folder's README says otherwise:

| Folder | Source | What |
|---|---|---|
| `rdap/` | rdap.org (redirects to the registries) | `ip-1.1.1.1`, `ip-2606_4700_4700__1111`, `ip-172.66.157.237`, `autnum-13335`, `domain-example.org` (contacts are role addresses of the registries; the one personal-looking e-mail of the registrar's abuse entity, `cbath@pir.org`, is rewritten `exemple@example.org`) |
| `ripestat/` | stat.ripe.net | `whois`, `abuse-contact-finder`, `network-info`, `prefix-overview`, `reverse-dns-ip`, `maxmind-geo-lite` for 1.1.1.1, 2606:4700:4700::1111, 172.66.157.237; `maxmind-geo-lite-193.0.6.139` |
| `internetdb/` | internetdb.shodan.io | 1.1.1.1, 172.66.157.237, 2606:4700:4700::1111 |
| `tor/`, `aws/`, `gcp/`, `cloudflare/` | check.torproject.org, ip-ranges.amazonaws.com, gstatic.com, cloudflare.com | the whole published lists (1,241 Tor exits; AWS 2.7 MB; Google Cloud 118 KB; Cloudflare v4 and v6) |
| `crtsh/example.org.json`, `cdx/example.org-*.json`, `doh/example.org.json` | crt.sh, the Wayback CDX API, Cloudflare DoH | example.org |
| `esri/waybackconfig.json` | s3-us-west-2.amazonaws.com | the whole Wayback configuration |
| `kartaview/48.8565,2.352.json` | api.kartaview.org | the real answer within 500 m of the Hôtel de Ville |

Files of the same folders about `192.0.2.x`, `203.0.113.x`, `*.example` domains and the demo's Boulangerie Durand are invented (documentation addresses cannot be asked). Not recorded: Mapillary (no token), Gravatar profiles (no public subject), SPN.
