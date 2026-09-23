# Static files

Served as they are, at the site's root.

- `world-countries.geojson` — country outlines for the map on `/analytics/`, from
  [Natural Earth](https://www.naturalearthdata.com) 1:110m Admin 0 countries, which is public
  domain. Trimmed to `iso_a2` and `name` with coordinates rounded to two decimals (172 KB, about
  53 KB over the wire), and fetched only by the analytics page. Rebuild it from
  `ne_110m_admin_0_countries.geojson` if a country's borders or codes change.
- `llms.txt`, `robots.txt`, the icons and `og-image.png` — what agents, crawlers and link previews read.
