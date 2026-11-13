"""Validate maintained HTML pages; rebuild sitemap only with --write-sitemap.
The old embedded-copy generator has been retired to prevent overwriting approved copy.
Edit the language HTML files directly. There is still no deployment build step.
"""
from pathlib import Path
import re, sys, xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parent
HOST="https://www.nullifycv.com"
LOCALES={"x-default":"", "en":"", "en-US":"us.html", "en-GB":"uk.html", "en-CA":"ca.html", "nl-NL":"nl.html", "de-DE":"de.html", "fr-FR":"fr.html", "es-ES":"es.html", "fi-FI":"fi.html", "sv-SE":"se.html", "ko-KR":"kr.html"}
LOCALE_PAGES=set(LOCALES.values())
PAGES=["", "about.html", "pro.html", "glossary.html", "case-study.html", "privacy.html", "terms.html", "blog/"]+[x+".html" for x in ["nl","us","de","fr","es","uk","ca","kr","se","fi"]]+["blog/"+p.name for p in sorted((ROOT/"blog").glob("*.html")) if p.name not in ["index.html","blog_index.html","blog_template.html"]]
for path in PAGES:
    f=ROOT/(path+"index.html" if not path or path.endswith("/") else path)
    text=f.read_text()
    assert '<meta name="robots" content="noindex' not in text, str(f)+" is unintentionally noindex"
    assert not re.search(r'^\+\s*<link rel="alternate"', text, re.MULTILINE), str(f)+" has accidental diff markup before hreflang"
    assert re.search(r'<title>[^<]+</title>',text), str(f)+" has no page title"
    assert re.search(r'<meta name="description" content="[^"]+">',text), str(f)+" has no meta description"
    match=re.search(r'<link rel="canonical" href="([^"]+)"',text)
    assert match and match.group(1)==HOST+"/"+path, str(f)+" has inconsistent canonical"
    og=re.search(r'<meta property="og:url" content="([^"]+)"',text)
    assert og and og.group(1).rstrip("/")==match.group(1).rstrip("/"), str(f)+" has inconsistent og:url"
    if path in LOCALE_PAGES:
        found=dict(re.findall(r'<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"',text))
        expected={lang:HOST+"/"+target for lang,target in LOCALES.items()}
        assert found==expected, str(f)+" has incomplete reciprocal hreflang links"
for extra in ["blog_index.html", "blog/blog_index.html", "blog/blog_template.html", "success.html"]:
    text=(ROOT/extra).read_text()
    assert re.search(r'<meta name="robots" content="noindex,follow">',text), extra+" must stay out of the index"
if "--write-sitemap" in sys.argv:
    root=ET.Element("urlset",xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")
    for path in PAGES: ET.SubElement(ET.SubElement(root,"url"),"loc").text=HOST+"/"+path
    ET.ElementTree(root).write(ROOT/"sitemap.xml",encoding="utf-8",xml_declaration=True)
print("Verified",len(PAGES),"canonical pages")
