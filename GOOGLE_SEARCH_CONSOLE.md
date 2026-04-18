# How to Add Google Search Console Verification

## Method 1 – HTML Meta Tag (Easiest)

1. Go to https://search.google.com/search-console
2. Click "Add Property" → Enter your website URL
3. Choose "HTML tag" verification method
4. Copy the meta tag. It looks like:
   ```
   <meta name="google-site-verification" content="abc123xyz..." />
   ```
5. Open `views/index.ejs`
6. Find this comment near the top (inside `<head>`):
   ```
   <!-- Google Search Console: paste your verification meta tag here -->
   <!-- <meta name="google-site-verification" content="YOUR_CODE_HERE" /> -->
   ```
7. Replace it with your actual tag (remove the comment tags).
8. Deploy the update to Render.
9. Click "Verify" in Search Console.

## Method 2 – HTML File

1. In Search Console choose "HTML file" verification
2. Download the verification file (e.g. `google1234abcd.html`)
3. Place it inside `public/` folder in your project
4. Deploy to Render
5. Verify at `https://yoursite.com/google1234abcd.html`

The server already has a route to handle these files automatically.

## After Verification

Submit your sitemap:
- Go to Search Console → Sitemaps
- Enter: `sitemap.xml`
- Add a sitemap.xml file in `/public/sitemap.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://yoursite.com/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>
```
