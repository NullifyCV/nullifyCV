/* ── NullifyCV · app.js v2.3.1 ───────────────────────────────────────────── */
/* Real PDF redaction: pdf.js finds PII positions, pdf-lib draws black bars   */
/* mammoth.js handles DOCX → clean text output                                */
'use strict';

function initPdfJs() {
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
}

let currentFile=null,detectedPII=[],redactedText='',auditData=null;
let pdfPositions=[];  // stores {text, x, y, w, h, page} for PDF coordinate redaction
let currentMode='standard';  // tracks the active redaction mode (standard/bias/client/eeoc)

const MODES={
  standard:{name:1,contact:1,location:1,gradyear:1},
  bias:{name:1,contact:1,location:1,gradyear:1,school:1,pronouns:1,photos:1},
  client:{name:1,contact:1,urls:1,metadata:1,photos:1},
  eeoc:{name:1,contact:1,location:1,gradyear:1,school:1,pronouns:1,urls:1,metadata:1,photos:1},
};

const PII_PATTERNS=[
  {key:'contact',type:'EMAIL',label:'Email address',conf:'high',
   re:/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g},
  {key:'contact',type:'PHONE',label:'Phone number',conf:'high',
   re:/(?:\+?31|0)[\s\-]?6[\s\-]?\d{2}[\s\-]?\d{2}[\s\-]?\d{2}[\s\-]?\d{2}/g},
  {key:'contact',type:'PHONE',label:'Phone number',conf:'high',
   re:/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g},
  {key:'contact',type:'PHONE',label:'Phone number',conf:'high',
   re:/\b0\d[\s\-]?\d{2}[\s\-]?\d{2}[\s\-]?\d{2}[\s\-]?\d{2}\b/g},
  {key:'location',type:'POSTCODE',label:'Postcode',conf:'high',
   re:/\b[1-9]\d{3}\s?[A-Z]{2}\b/g},
  {key:'location',type:'ZIP',label:'Zip code',conf:'high',
   re:/\b\d{5}(?:-\d{4})?\b/g},
  {key:'location',type:'CITY',label:'City',conf:'high',
   re:/\b(?:Amsterdam|Rotterdam|Den Haag|Utrecht|Eindhoven|Tilburg|Groningen|Almere|Breda|Nijmegen|Enschede|Haarlem|Arnhem|Zaanstad|Amersfoort|Apeldoorn|'s-Hertogenbosch|Hoofddorp|Maastricht|Leiden|Dordrecht|Zoetermeer|Zwolle|Deventer|Delft|Alkmaar|Heerlen|Venlo|Leeuwarden|Amstelveen|Hilversum|Purmerend|Roosendaal|Middelburg|Assen|Lelystad|Emmen|Helmond|Ede|Sittard|Gouda|Hengelo|Almelo|Zaandam|Vlaardingen|Schiedam)\b/g},
  {key:'location',type:'CITY_ST',label:'City, state',conf:'high',
   re:/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)?,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/g},
  {key:'contact',type:'ADDRESS',label:'Street address',conf:'high',
   re:/\b\d{1,5}\s+[A-Z][a-z]+(?:\s[A-Za-z]+){1,4}(?:\s(?:St|Ave|Blvd|Dr|Rd|Ln|Ct|Way|Pl|straat|laan|weg|plein|dreef|singel|kade|dijk|gracht)\.?)\b/gi},
  // Dutch address format: streetname (ending in straat/laan/weg/etc) + number, sometimes + addition
  {key:'contact',type:'ADDRESS',label:'Street address',conf:'high',
   re:/\b[A-Z][a-zA-Z\u00C0-\u024F]+(?:straat|laan|weg|plein|dreef|singel|kade|dijk|gracht|hof|park|baan|hoek|berg|ring|wal)\s+\d{1,5}(?:\s*[A-Z](?:\s+\d{1,4}\s*[A-Z]{0,2})?)?\b/g},
  // Graduation year — explicit graduation context only.
  // Matches: "Class of 2020", "Graduated: 2020", and English month+year forms
  // typical of US graduation conventions (May/June/December 2020).
  // Dutch month names are deliberately NOT included here: in Dutch CVs, work
  // history is commonly written as "januari 2020 - juni 2022", and recruiters
  // need that timeline visible. Dutch graduation years tend to appear as
  // standalone years which are no longer redacted by default.
  {key:'gradyear',type:'GRAD_YR',label:'Graduation year',conf:'high',
   re:/\b(?:Class of |Graduated?:?\s*|(?:May|June|December)\s+)(?:19|20)\d{2}\b/g},
  // NOTE: The previous "YEAR (age proxy)" rule that matched any naked year between
  // 1940 and 2016 has been removed — it was incorrectly redacting employment-history
  // dates (e.g. "Jan 2016 – Jan 2019" had its 2016 barred). Recruiters need the
  // work timeline visible to evaluate candidates. Date-of-birth is still caught
  // by the dedicated DOB patterns below, which require a labeled field or a
  // day+month+year pattern that work-history dates don't share.
  {key:'urls',type:'LINKEDIN',label:'LinkedIn URL',conf:'high',
   re:/(?:linkedin\.com\/in\/)[A-Za-z0-9\-_%]+/gi},
  {key:'urls',type:'URL',label:'URL',conf:'high',
   re:/https?:\/\/[^\s"'<>]+/gi},
  {key:'pronouns',type:'PRONOUN',label:'Pronouns',conf:'high',
   re:/\b(?:He\/Him|She\/Her|They\/Them|he\/him|she\/her|they\/them|hij\/hem|zij\/haar)\b/g},
  {key:'school',type:'SCHOOL',label:'School name',conf:'high',
   re:/\b(?:Universiteit\s+(?:van\s+)?[A-Z][a-z]+(?:\s[A-Z][a-z]+)*|Hogeschool\s+[A-Z][a-z]+(?:\s[A-Z][a-z]+)*|University of [A-Z][a-z]+(?:\s[A-Z][a-z]+)*|[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\s+University|[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\s+College|MIT|UCLA|USC|NYU|CMU|TU Delft|TU Eindhoven|UvA|VU Amsterdam)\b/g},
  // Single-line name as the FIRST line of the document (e.g. "Jane Doe").
  // Anchored at absolute start of text (no /m flag), so it only matches if the
  // name is the very first content. Uses literal space (not \s) so it cannot
  // bleed across newlines into subsequent lines. The /g flag is required for
  // the scanForPII loop — without it, re.exec stays at lastIndex 0 and
  // infinite-loops. With /g but no /m, ^ still only matches position 0.
  {key:'name',type:'NAME',label:'Full name',conf:'high',
   re:/^[A-Z][a-zA-Z\u00C0-\u024F\-]+(?: [A-Z][a-zA-Z\u00C0-\u024F\-]+){1,3}(?=\n|$)/g},
  // Multi-line name: two single capitalized words on consecutive lines starting at document start.
  // Anchored at absolute document start to avoid false positives mid-document.
  {key:'name',type:'NAME',label:'Full name (multi-line)',conf:'high',
   re:/^[A-Z][a-zA-Z\u00C0-\u024F\-]{2,30}\n[A-Z][a-zA-Z\u00C0-\u024F\-]{2,30}(?=\n|$)/g},
  {key:'contact',type:'DOB',label:'Date of birth',conf:'high',
   re:/\b(?:geboortedatum|geboren op|date of birth|dob|geburtsdatum|geboren am|date de naissance|né\(?e?\)? le|fecha de nacimiento|nacido el|nascido em|data di nascita):?\s*\d{1,2}[\s\-\/]\d{1,2}[\s\-\/]\d{2,4}\b/gi},
  {key:'contact',type:'DOB',label:'Date of birth',conf:'med',
   re:/\b\d{1,2}\s+(?:januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+\d{4}\b/gi},
  // Nationality — labeled-field only, multi-language. Requires "Label: value"
  // form with an explicit colon to avoid false positives on body-text mentions
  // (e.g. "Nationality is not relevant to..."). Captures up to 60 chars of value
  // on the same line. EEOC-mode redaction target: nationality is a protected
  // characteristic. We deliberately do NOT try to detect free-text mentions
  // ("I am a Dutch citizen") because the false-positive risk is too high.
  {key:'contact',type:'NATIONALITY',label:'Nationality',conf:'high',
   re:/\b(?:nationaliteit|nationality|citizenship|staatsangehörigkeit|nationalität|nationalité|nacionalidad|nacionalidade|nazionalità)\s*:\s*[^\n\r]{1,60}/gi},
  {key:'contact',type:'BSN',label:'BSN / National ID',conf:'high',
   re:/\b(?:BSN|burgerservicenummer):?\s*\d{8,9}\b/gi},
];

const $=id=>document.getElementById(id);
const fmtSize=b=>b<1024?b+' B':b<1048576?Math.round(b/1024)+' KB':(b/1048576).toFixed(1)+' MB';
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const slp=ms=>new Promise(r=>setTimeout(r,ms));
function setStatus(msg,pct){$('stxt').textContent=msg;$('pbar').style.width=pct+'%';}
function showError(msg){const e=$('err');e.textContent='⚠ '+msg;e.classList.add('show');}
function clearError(){$('err').classList.remove('show');}
function getActiveKeys(){
  const k={};
  // Keys from UI toggle cards (visible categories the user can toggle)
  document.querySelectorAll('.tcard.on').forEach(c=>{k[c.dataset.key]=1});
  // Mode-only keys that have no UI card (e.g. photos — driven entirely by mode selection)
  const modeKeys = MODES[currentMode] || {};
  if (modeKeys.photos) k.photos = 1;
  return k;
}

function setMode(mode,btn){
  const previousMode = currentMode;
  currentMode = mode;
  document.querySelectorAll('.tab').forEach(t=>{t.classList.remove('on');t.setAttribute('aria-selected','false');});
  btn.classList.add('on');btn.setAttribute('aria-selected','true');
  const cfg=MODES[mode]||{};
  document.querySelectorAll('.tcard').forEach(card=>{
    const on=!!cfg[card.dataset.key];
    card.classList.toggle('on',on);
    card.setAttribute('aria-checked',on?'true':'false');
    card.querySelector('.tbox').textContent=on?'✓':'';
  });
  updateBatchModeBanner();
  // Analytics: which modes do users actually explore?
  // Helps answer: should Bias Strip be the default? Is EEOC ever used?
  // Only fire when user actually changed mode (not initial setup).
  if (window.va && previousMode && previousMode !== mode) {
    window.va('event', { name: 'mode_changed', from: previousMode, to: mode });
  }
}

/* Updates the mode-indicator banner in the batch section so users always see
   which mode their next batch run will use. Called on init and after setMode. */
function updateBatchModeBanner(){
  const nameEl=document.getElementById('batch-mode-name');
  const targetsEl=document.getElementById('batch-mode-targets');
  if(!nameEl||!targetsEl)return;
  const labels={standard:'Standard PII',bias:'Bias Strip',client:'Client Submission',eeoc:'EEOC Blind Review'};
  nameEl.textContent=labels[currentMode]||'Standard PII';
  const keys=Object.keys(getActiveKeys());
  targetsEl.textContent=keys.length?keys.join(', '):'(no targets selected)';
}

/* Photo warning: surfaces when PDF contains photos that won't be redacted in current mode.
   Injects a warning banner above the status area, idempotent (safe to call multiple times). */
function showPhotoWarning(count) {
  let w = $('photoWarn');
  if (!w) {
    w = document.createElement('div');
    w.id = 'photoWarn';
    w.style.cssText = 'background:#fff8e1;border:1px solid #f0d585;color:#6b5418;padding:11px 14px;border-radius:6px;font-size:12px;line-height:1.55;margin:10px 0;display:flex;gap:10px;align-items:flex-start;';
    const status = $('ss') || $('stxt');
    if (status && status.parentNode) status.parentNode.insertBefore(w, status);
  }
  const plural = count === 1 ? '' : 's';
  w.innerHTML = '<span style="font-size:14px;line-height:1;">⚠</span><div><strong>'+count+' photo'+plural+' detected but not redacted.</strong> Photos are kept in <em>Standard</em> mode. Switch to <strong>Bias Strip</strong>, <strong>Client Submission</strong>, or <strong>EEOC Blind Review</strong> mode and re-process to remove them.</div>';
  w.style.display = 'flex';
}
function hidePhotoWarning() {
  const w = $('photoWarn');
  if (w) w.style.display = 'none';
}

function toggleCard(el){
  el.classList.toggle('on');
  const on=el.classList.contains('on');
  el.setAttribute('aria-checked',on?'true':'false');
  el.querySelector('.tbox').textContent=on?'✓':'';
  updateBatchModeBanner();
}

function dov(e){e.preventDefault();$('drop').classList.add('over');}
function ddr(e){e.preventDefault();$('drop').classList.remove('over');const f=e.dataTransfer.files[0];if(f)loadFile(f);}
function fsel(e){const f=e.target.files[0];if(f)loadFile(f);}

function loadFile(file){
  const ext=file.name.split('.').pop().toLowerCase();
  if(!['pdf','docx','doc'].includes(ext)){showError('Please upload a PDF or DOCX file.');return;}
  clearError();
  currentFile=file;detectedPII=[];redactedText='';auditData=null;pdfPositions=[];
  hidePhotoWarning();
  $('fext').textContent=ext.toUpperCase();
  $('fname').textContent=file.name;
  $('fsize').textContent=fmtSize(file.size)+' · Ready to nullify';
  $('frow').classList.add('show');
  $('drop').style.display='none';
  $('pbtn').disabled=false;
  ['piiwrap','ss','prev','pad'].forEach(id=>$(id).classList.remove('show'));
  // Analytics: a file was uploaded (no filename or content sent — just the format)
  if (window.va) window.va('event', { name: 'file_upload', format: ext });
}

function clearFile(){
  currentFile=null;$('frow').classList.remove('show');$('drop').style.display='';
  $('pbtn').disabled=true;$('fi').value='';clearError();pdfPositions=[];
  hidePhotoWarning();
  ['piiwrap','ss','prev','pad'].forEach(id=>$(id).classList.remove('show'));
}

/* ── PDF: extract text WITH positions using pdf.js ───────────────────────── */
async function extractPDFData(file){
  if(typeof pdfjsLib==='undefined')
    throw new Error('pdf.js not loaded — please reload the page.');

  const ab=await file.arrayBuffer();
  // Keep a second copy of the raw bytes for pdf-lib to write onto
  const ab2=ab.slice(0);

  const pdf=await pdfjsLib.getDocument({data:ab}).promise;
  let fullText='';
  const allItems=[];  // {str, x, y, w, h, pageNum, pageHeight}
  const allImages=[]; // {x, y, w, h, pageNum, source} — positions of embedded images
  const pageOpCounts=[]; // per-page operator counts for diagnostics
  const pageCanvases=[]; // {pageNum, canvas, scale} — for thumbnail extraction

  for(let p=1;p<=pdf.numPages;p++){
    const page=await pdf.getPage(p);
    const viewport=page.getViewport({scale:1});
    const pageHeight=viewport.height;
    const tc=await page.getTextContent();

    let pageText='',lastY=null,lastX=null;
    for(const item of tc.items){
      if(!item.str||!item.str.trim())continue;
      const x=item.transform[4];
      // pdf.js uses bottom-left origin; pdf-lib uses bottom-left too — same coordinate space
      const y=item.transform[5];
      const w=item.width||0;
      const h=item.height||10;

      if(lastY!==null&&Math.abs(y-lastY)>2){pageText+='\n';lastX=null;}
      if(lastX!==null&&x-lastX>3&&lastY!==null&&Math.abs(y-lastY)<=2)pageText+=' ';
      pageText+=item.str;
      lastY=y;lastX=x+w;

      allItems.push({str:item.str,x,y,w,h,pageNum:p,pageHeight});
    }
    fullText+=pageText.trim()+'\n\n';

    /* ── Render page to canvas for later thumbnail extraction ────────────── */
    /* We render at moderate scale so we can crop accurate thumbnails of each
       detected image. Only renders if there are images to thumbnail. The
       canvas is kept in memory until the user is done with the picker. */
    try {
      const renderScale = 1.5; // 1.5× page dimensions for sharp thumbnails
      const renderViewport = page.getViewport({scale: renderScale});
      const canvas = document.createElement('canvas');
      canvas.width = renderViewport.width;
      canvas.height = renderViewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({canvasContext: ctx, viewport: renderViewport}).promise;
      pageCanvases.push({pageNum: p, canvas, scale: renderScale, height: pageHeight});
    } catch (e) {
      console.warn('Page render for thumbnails failed on page ' + p + ':', e);
    }

    /* ── Detect embedded images on this page ─────────────────────────────── */
    /* pdf.js exposes images via the operator list. Each image-painting op is
       preceded by transform ops that determine where the image lands on the
       page. We walk the operator list maintaining a transform stack and
       capture the resulting bounding box for every image draw call.
       
       Some PDF authoring tools (notably Canva and similar template tools)
       wrap images inside Form XObjects. We need to detect those by tracking
       the boundaries of the wrapping form and treating the form itself as
       the image area when the form contains no recognizable image op. */
    try {
      const ops = await page.getOperatorList();
      const OPS = pdfjsLib.OPS;
      // Transform stack — each entry is [a, b, c, d, e, f] (PDF transform matrix)
      let ctm = [1, 0, 0, 1, 0, 0];
      const stack = [];
      // Track form/group nesting and image-bearing forms
      const formStack = []; // each item: { startCtm, hadImage }
      // Diagnostic: counts of each op code seen, to help diagnose future failures
      const opCounts = {};

      const multiply = (m1, m2) => [
        m1[0]*m2[0] + m1[2]*m2[1],
        m1[1]*m2[0] + m1[3]*m2[1],
        m1[0]*m2[2] + m1[2]*m2[3],
        m1[1]*m2[2] + m1[3]*m2[3],
        m1[0]*m2[4] + m1[2]*m2[5] + m1[4],
        m1[1]*m2[4] + m1[3]*m2[5] + m1[5],
      ];

      const computeBoundingBox = (matrix) => {
        const [a, b, c, d, e, f] = matrix;
        const corners = [
          [e, f],
          [a + e, b + f],
          [c + e, d + f],
          [a + c + e, b + d + f],
        ];
        const xs = corners.map(c => c[0]);
        const ys = corners.map(c => c[1]);
        return {
          x: Math.min(...xs),
          y: Math.min(...ys),
          w: Math.max(...xs) - Math.min(...xs),
          h: Math.max(...ys) - Math.min(...ys),
        };
      };

      // Build a name lookup for ops so we can log unrecognized ones
      const opNames = {};
      for (const k in OPS) opNames[OPS[k]] = k;

      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        const args = ops.argsArray[i];
        const opName = opNames[fn] || ('op_' + fn);
        opCounts[opName] = (opCounts[opName] || 0) + 1;

        if (fn === OPS.save) {
          stack.push(ctm.slice());
        } else if (fn === OPS.restore) {
          if (stack.length) ctm = stack.pop();
        } else if (fn === OPS.transform) {
          ctm = multiply(ctm, args);
        } else if (fn === OPS.paintImageXObject ||
                   fn === OPS.paintInlineImageXObject ||
                   fn === OPS.paintJpegXObject ||
                   fn === OPS.paintImageMaskXObject) {
          // Direct image paint — capture its bounds via current transform
          const box = computeBoundingBox(ctm);
          if (box.w >= 20 && box.h >= 20) {
            allImages.push({ ...box, pageNum: p, source: 'direct' });
          }
          // Mark any active forms as containing an image (so we don't double-mark them)
          for (const f of formStack) f.hadImage = true;
        } else if (fn === OPS.beginGroup ||
                   fn === OPS.paintFormXObjectBegin ||
                   fn === OPS.beginAnnotation) {
          // Entering a form/group — record the matrix at this point
          formStack.push({ startCtm: ctm.slice(), hadImage: false });
        } else if (fn === OPS.endGroup ||
                   fn === OPS.paintFormXObjectEnd ||
                   fn === OPS.endAnnotation) {
          // Leaving a form/group — if it didn't contain a direct image but
          // had a non-trivial bounding box, it MIGHT be a wrapped image.
          // We don't auto-add these because too many forms are vector-only
          // (decorative shapes, frames). Just track them for diagnostics.
          formStack.pop();
        }
      }

      // Stash diagnostic info for the audit log
      pageOpCounts.push({ page: p, ops: opCounts });
    } catch (e) {
      // If we can't read the operator list (corrupted PDF, unusual format),
      // we degrade gracefully — text redaction still works, photos may survive.
      console.warn('Image detection failed for page ' + p + ':', e);
    }
  }

  if(!fullText.trim())
    throw new Error('No text layer found in this PDF. It may be a scanned image — please export as DOCX.');

  return {text:fullText.trim(), items:allItems, images:allImages, rawBytes:ab2, numPages:pdf.numPages, pageOpCounts, pageCanvases};
}

/* ── Photo discrimination heuristic ──────────────────────────────────────── */
/* Profile photos look different from decorative template shapes:
   - Aspect ratio: roughly square or portrait (0.5–2.0)
   - Size: between 4% and 30% of an A4 page (around 80×80 px to 350×400 px)
   - Page: photos are almost always on page 1 only
   - Position: typically in upper half or in a sidebar
   We err on the side of redacting — false positives (extra black box) are
   less harmful than false negatives (photo survives). */
function filterToLikelyPhotos(images, numPages) {
  const A4_WIDTH = 595;   // PDF points (1pt = 1/72 inch)
  const A4_HEIGHT = 842;
  const A4_AREA = A4_WIDTH * A4_HEIGHT;

  const kept = [];
  const rejected = [];
  const rejectedReasons = {};

  for (const img of images) {
    const reasons = [];
    const aspect = img.h > 0 ? img.w / img.h : 0;
    const area = img.w * img.h;
    const areaPct = (area / A4_AREA) * 100;

    // Reject: too small (icons, tiny decorations)
    if (img.w < 60 || img.h < 60) {
      reasons.push('too_small');
    }
    // Reject: too large (full-page backgrounds)
    if (areaPct > 35) {
      reasons.push('too_large');
    }
    // Reject: extreme aspect ratio (banner strips, separator lines)
    if (aspect < 0.4 || aspect > 2.5) {
      reasons.push('extreme_aspect_ratio');
    }
    // Reject: not on page 1 (decorative template elements that repeat)
    if (img.pageNum > 1) {
      reasons.push('not_page_1');
    }

    if (reasons.length === 0) {
      kept.push(img);
    } else {
      rejected.push({...img, reasons});
      const key = reasons.join(',');
      rejectedReasons[key] = (rejectedReasons[key] || 0) + 1;
    }
  }

  return { kept, rejected, rejectedReasons };
}

/* ── Crop image thumbnail from rendered page canvas ──────────────────────── */
/* PDF coordinates have origin at bottom-left; canvas at top-left. We invert Y. */
function cropImageThumbnail(image, pageCanvases) {
  const pc = pageCanvases.find(p => p.pageNum === image.pageNum);
  if (!pc) return null;
  const {canvas, scale, height: pageHeight} = pc;

  // Transform PDF coords → canvas coords
  const cx = image.x * scale;
  const cy = (pageHeight - image.y - image.h) * scale; // flip Y
  const cw = image.w * scale;
  const ch = image.h * scale;

  // Clamp to canvas bounds (sometimes coords slightly exceed)
  const x = Math.max(0, Math.floor(cx));
  const y = Math.max(0, Math.floor(cy));
  const w = Math.min(canvas.width - x, Math.ceil(cw));
  const h = Math.min(canvas.height - y, Math.ceil(ch));
  if (w <= 0 || h <= 0) return null;

  // Draw to a smaller thumbnail canvas
  const THUMB_MAX = 140;
  const aspect = w / h;
  const thumbW = aspect > 1 ? THUMB_MAX : Math.round(THUMB_MAX * aspect);
  const thumbH = aspect > 1 ? Math.round(THUMB_MAX / aspect) : THUMB_MAX;

  const thumb = document.createElement('canvas');
  thumb.width = thumbW;
  thumb.height = thumbH;
  const tctx = thumb.getContext('2d');
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(canvas, x, y, w, h, 0, 0, thumbW, thumbH);
  return thumb.toDataURL('image/png');
}

/* ── Image picker UI ─────────────────────────────────────────────────────── */
/* Shows detected images as thumbnails with checkboxes. User selects which to
   redact. Returns a Promise that resolves with the array of selected images.
   Returns null if user cancels. */
function showImagePicker(images, pageCanvases, suggestedRedactions) {
  return new Promise((resolve) => {
    // Build thumbnails
    const items = images.map(img => ({
      img,
      thumb: cropImageThumbnail(img, pageCanvases),
      suggested: suggestedRedactions.some(s => s.x === img.x && s.y === img.y && s.pageNum === img.pageNum),
    }));

    // Skip the picker if there are no images at all
    if (items.length === 0) { resolve([]); return; }

    // Build the modal
    const overlay = document.createElement('div');
    overlay.className = 'imgpick-overlay';
    overlay.innerHTML = `
      <div class="imgpick-modal" role="dialog" aria-modal="true" aria-labelledby="imgpick-title">
        <div class="imgpick-header">
          <h3 id="imgpick-title">Which images should be redacted?</h3>
          <p class="imgpick-sub">We found ${items.length} image${items.length===1?'':'s'} in this CV. Profile photos are pre-selected. Uncheck any decorative shapes you want to keep.</p>
        </div>
        <div class="imgpick-grid" id="imgpick-grid"></div>
        <div class="imgpick-actions">
          <button type="button" class="imgpick-btn imgpick-cancel" id="imgpick-cancel">Cancel — don't process</button>
          <div class="imgpick-action-right">
            <button type="button" class="imgpick-btn imgpick-toggle" id="imgpick-none">Select none</button>
            <button type="button" class="imgpick-btn imgpick-toggle" id="imgpick-all">Select all</button>
            <button type="button" class="imgpick-btn imgpick-confirm" id="imgpick-confirm">Continue with selected →</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const grid = overlay.querySelector('#imgpick-grid');
    const checkedState = items.map(it => it.suggested);

    items.forEach((it, idx) => {
      const cell = document.createElement('label');
      cell.className = 'imgpick-cell';
      const sizeStr = `${Math.round(it.img.w)}×${Math.round(it.img.h)}`;
      const pageStr = `Page ${it.img.pageNum}`;
      cell.innerHTML = `
        <div class="imgpick-thumb-wrap">
          ${it.thumb
            ? `<img class="imgpick-thumb" src="${it.thumb}" alt="Detected image ${idx+1}">`
            : `<div class="imgpick-thumb imgpick-thumb-missing">no preview</div>`}
          <div class="imgpick-check"><input type="checkbox" data-idx="${idx}" ${it.suggested?'checked':''} aria-label="Redact image ${idx+1}"></div>
        </div>
        <div class="imgpick-meta">${pageStr} · ${sizeStr}</div>
      `;
      grid.appendChild(cell);
    });

    const cleanup = (selected) => {
      document.body.removeChild(overlay);
      document.body.style.overflow = '';
      resolve(selected);
    };

    grid.addEventListener('change', (e) => {
      const cb = e.target.closest('input[type="checkbox"]');
      if (!cb) return;
      const idx = parseInt(cb.dataset.idx, 10);
      checkedState[idx] = cb.checked;
    });

    overlay.querySelector('#imgpick-all').addEventListener('click', () => {
      grid.querySelectorAll('input[type="checkbox"]').forEach((cb, i) => {
        cb.checked = true;
        checkedState[i] = true;
      });
    });
    overlay.querySelector('#imgpick-none').addEventListener('click', () => {
      grid.querySelectorAll('input[type="checkbox"]').forEach((cb, i) => {
        cb.checked = false;
        checkedState[i] = false;
      });
    });

    overlay.querySelector('#imgpick-confirm').addEventListener('click', () => {
      const selected = items.filter((it, i) => checkedState[i]).map(it => it.img);
      cleanup(selected);
    });
    overlay.querySelector('#imgpick-cancel').addEventListener('click', () => cleanup(null));

    document.body.style.overflow = 'hidden';
  });
}

/* ── Find which text items contain PII ──────────────────────────────────────*/
function findPIIPositions(items, piiValues){
  const positions=[];
  // Diagnostic tracking: which PII values found positions, which were dropped
  const diagnostics = { located: [], dropped: [] };
  // Group items by page and approximate y once (avoids rebuilding per pii value)
  const allByPageY={};
  for(const item of items){
    const key=item.pageNum+'_'+Math.round(item.y);
    if(!allByPageY[key])allByPageY[key]=[];
    allByPageY[key].push(item);
  }
  // Sort each line left-to-right
  for(const key of Object.keys(allByPageY)){
    allByPageY[key].sort((a,b)=>a.x-b.x);
  }

  // Normalize input: piiValues may be array of strings OR array of PII objects.
  // If it's an object with `prelocated` items, use those directly — skip string search.
  // This is critical for positional name detection: we already know exactly which
  // items contain the name, so re-scanning the text by string would lose precision.
  const normalized = piiValues.map(v => {
    if (typeof v === 'string') return { value: v, prelocated: null };
    return { value: v.value || '', prelocated: v.prelocated || null };
  });

  for (const entry of normalized) {
    const positionsBefore = positions.length;

    // Prelocated items: emit one redaction rectangle per item — no string search.
    if (entry.prelocated && entry.prelocated.length > 0) {
      const padding = 2;
      for (const item of entry.prelocated) {
        positions.push({
          pageNum: item.pageNum,
          x: item.x - padding,
          y: item.y - padding,
          w: item.w + padding * 2,
          h: item.h + padding * 2,
          piiVal: entry.value,
        });
      }
      diagnostics.located.push({ value: entry.value, method: 'prelocated', boxes: positions.length - positionsBefore });
      continue;
    }

    const piiVal = entry.value;
    const valLower=piiVal.toLowerCase();
    const valTrim=valLower.trim();
    if(!valTrim){
      diagnostics.dropped.push({ value: entry.value, reason: 'empty_after_trim' });
      continue;
    }

    // Try same-line match first
    let sameLineMatches = 0;
    // The PII value may have been extracted from text where pdf.js joined adjacent
    // items without spaces (e.g., "0627963113" was found in "06 27 96 31 13" because
    // pageText collapses small-x-gap items). When we look for the substring in the
    // line, we must do it whitespace-insensitively, otherwise we silently drop the
    // redaction.
    //
    // We also strip parentheses, hyphens, and other punctuation that pdf.js may
    // render differently from how the scanner detected the value. For example,
    // a phone "+(31) 6 83266364" extracted as a single phrase still matches the
    // scanner's "+31 6 83266364" because we compare after stripping non-essentials.
    //
    // Email addresses are special: we keep @ and . since those are the key
    // delimiters distinguishing emails from random adjacent digits.
    const stripForCompare = (s, keepDots) => {
      // Keep letters, digits, @ — and dots only for email-like values
      const allowed = keepDots ? /[a-zA-Z0-9@.]/ : /[a-zA-Z0-9@]/;
      let out = '';
      for (const c of s) if (allowed.test(c)) out += c;
      return out;
    };
    const isEmailLike = /@/.test(valTrim);
    const valStripped = stripForCompare(valTrim, isEmailLike).toLowerCase();
    if (!valStripped) {
      diagnostics.dropped.push({ value: piiVal, reason: 'empty_after_strip' });
      continue;
    }
    for(const key of Object.keys(allByPageY)){
      const lineItems=allByPageY[key];
      // Build a parallel index: for each "kept" char in the joined line,
      // remember which item it came from.
      let stripped='';
      const charToItem=[];
      for(let i=0;i<lineItems.length;i++){
        for(const c of lineItems[i].str){
          const allowed = isEmailLike ? /[a-zA-Z0-9@.]/ : /[a-zA-Z0-9@]/;
          if(!allowed.test(c))continue;
          stripped+=c;
          charToItem.push(i);
        }
      }
      const lower = stripped.toLowerCase();
      let searchFrom=0;
      while(true){
        const idx=lower.indexOf(valStripped,searchFrom);
        if(idx===-1)break;
        const endIdx=idx+valStripped.length-1;
        const startItem=lineItems[charToItem[idx]];
        const endItem=lineItems[charToItem[endIdx]];
        const padding=2;
        positions.push({
          pageNum:startItem.pageNum,
          x:startItem.x-padding,
          y:Math.min(startItem.y,endItem.y)-padding,
          w:(endItem.x+endItem.w)-(startItem.x)+(padding*2),
          h:Math.max(startItem.h,endItem.h)+(padding*2),
          piiVal,
        });
        sameLineMatches++;
        searchFrom=endIdx+1;
      }
    }

    // Multi-line match: try matching across two adjacent lines on the same page.
    // Common case: "Kevin\nNlandu" or "Bijlmerdreef 173C 1102\nBP Amsterdam".
    // We only try 2-line spans (3+ lines is rare for PII).
    let multiLineMatches = 0;
    if(valTrim.includes(' ')){
      const linesByPage={};
      for(const key of Object.keys(allByPageY)){
        const [page,y]=key.split('_');
        if(!linesByPage[page])linesByPage[page]=[];
      linesByPage[page].push({y:parseFloat(y),items:allByPageY[key]});
    }
    for(const page of Object.keys(linesByPage)){
      const lines=linesByPage[page].sort((a,b)=>b.y-a.y); // top-to-bottom (high y first in PDF coords)
      for(let i=0;i<lines.length-1;i++){
        const l1=lines[i],l2=lines[i+1];
        // Only consider lines that are vertically adjacent (within ~2× line height)
        const l1h=l1.items[0]?.h||10;
        if(Math.abs(l1.y-l2.y)>l1h*3)continue;
        // Build punctuation-stripped combined string with char-to-item mapping
        const allowed = isEmailLike ? /[a-zA-Z0-9@.]/ : /[a-zA-Z0-9@]/;
        let combined = '';
        const itemMap = [];
        for(const it of l1.items){
          for(const c of it.str){
            if(!allowed.test(c))continue;
            combined+=c;
            itemMap.push({item:it,line:1});
          }
        }
        for(const it of l2.items){
          for(const c of it.str){
            if(!allowed.test(c))continue;
            combined+=c;
            itemMap.push({item:it,line:2});
          }
        }
        const lower=combined.toLowerCase();
        if(!lower.includes(valStripped))continue;
        const matchStart=lower.indexOf(valStripped);
        const matchEnd=matchStart+valStripped.length-1;
        // CRITICAL: only emit multi-line redactions if the match actually STRADDLES
        // both lines. If the entire match is within line 1 (or entirely within line 2),
        // it's a same-line match — already handled in the previous block. Without this
        // guard, the multi-line code falsely expands the redaction to include items
        // from line 2 that don't contain any part of the matched value.
        const startsInLine1 = itemMap[matchStart] && itemMap[matchStart].line === 1;
        const endsInLine2 = itemMap[matchEnd] && itemMap[matchEnd].line === 2;
        if(!(startsInLine1 && endsInLine2))continue;
        // Collect unique items touched by the matched range
        const seen=new Set();
        const itemsToRedact=[];
        for(let pos=matchStart;pos<=matchEnd;pos++){
          const ref=itemMap[pos];
          if(!ref||seen.has(ref.item))continue;
          seen.add(ref.item);
          itemsToRedact.push(ref.item);
        }
        // Skip if same-line match already produced positions for this — avoid double redaction.
        // We push one rectangle per item to handle the geometry correctly.
        const padding=2;
        for(const item of itemsToRedact){
          positions.push({
            pageNum:item.pageNum,
            x:item.x-padding,
            y:item.y-padding,
            w:item.w+padding*2,
            h:item.h+padding*2,
            piiVal,
          });
          multiLineMatches++;
        }
      }
    }
    } // end if(valTrim.includes(' '))

    // Record what happened to this PII value
    const totalMatches = sameLineMatches + multiLineMatches;
    if (totalMatches > 0) {
      diagnostics.located.push({
        value: piiVal,
        method: sameLineMatches > 0 ? 'same-line' : 'multi-line',
        same_line: sameLineMatches,
        multi_line: multiLineMatches,
      });
    } else {
      diagnostics.dropped.push({
        value: piiVal,
        reason: 'no_match_in_any_line',
      });
    }
  }
  // Stash diagnostics on the positions array so callers can access without
  // breaking the existing return contract.
  positions._diagnostics = diagnostics;
  return positions;
}

/* ── True PDF redaction by rasterization ─────────────────────────────────────
   CRITICAL: drawing black rectangles with pdf-lib only COVERS text — the text
   stays in the PDF's text layer and can be copy-pasted or extracted. That is a
   security failure for a redaction tool.

   This function instead RASTERIZES each page: it renders the page to a canvas,
   draws the black redaction rectangles onto the canvas pixels, then rebuilds the
   PDF with each page replaced by that flattened image. The original text layer
   is destroyed entirely — there is no text anywhere in the output, so nothing
   under a redaction bar can be recovered. The output is image-based (not
   text-selectable), which is the correct, expected behaviour for a redacted
   document.

   `positions` and `imagePositions` are rectangles in PDF coordinate space
   (bottom-left origin), matching pdf.js text-item transforms.                  */
async function buildRedactedPDF(rawBytes, positions, imagePositions){
  if(typeof PDFLib==='undefined')
    throw new Error('pdf-lib not loaded — please reload the page.');
  if(typeof pdfjsLib==='undefined')
    throw new Error('pdf.js not loaded — please reload the page.');

  // RENDER_SCALE controls output sharpness. 2.0 keeps text crisp at the cost of
  // a larger file. Lower it if files get too big; raise it for sharper output.
  const RENDER_SCALE = 2.0;

  // Group redaction rectangles by page so we draw the right ones on each page.
  const byPage = {};
  for(const pos of (positions||[])){
    (byPage[pos.pageNum] = byPage[pos.pageNum] || []).push({ ...pos, kind:'text' });
  }
  for(const img of (imagePositions||[])){
    (byPage[img.pageNum] = byPage[img.pageNum] || []).push({ ...img, kind:'image' });
  }

  // pdf.js needs its own copy of the bytes (it transfers/detaches the buffer).
  const srcDoc = await pdfjsLib.getDocument({ data: rawBytes.slice(0) }).promise;
  const outDoc = await PDFLib.PDFDocument.create();

  for(let p=1; p<=srcDoc.numPages; p++){
    const page = await srcDoc.getPage(p);
    const viewport = page.getViewport({ scale: RENDER_SCALE });

    // Render the page to an offscreen canvas.
    const canvas = document.createElement('canvas');
    canvas.width  = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    // White backdrop — some PDFs have transparent backgrounds.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    // Draw redaction rectangles directly onto the canvas pixels.
    // positions are PDF-space (bottom-left origin); canvas is top-left origin.
    const pageRects = byPage[p] || [];
    const pageHeightPdf = page.getViewport({ scale: 1 }).height;
    ctx.fillStyle = '#000000';
    for(const r of pageRects){
      const pad = 2; // cover anti-aliased glyph edges
      const rw = (r.kind === 'text' ? Math.max(r.w, 20) : r.w) + pad*2;
      const rh = (r.kind === 'text' ? Math.max(r.h, 10) : r.h) + pad*2;
      const pdfX = r.x - pad;
      const pdfY = r.y - pad;
      // Flip Y: PDF bottom-left → canvas top-left. Then scale into canvas pixels.
      const cx = pdfX * RENDER_SCALE;
      const cy = (pageHeightPdf - pdfY - rh) * RENDER_SCALE;
      ctx.fillRect(cx, cy, rw * RENDER_SCALE, rh * RENDER_SCALE);
    }

    // Flatten the canvas to a JPEG and embed it as the entire page.
    // JPEG at 0.92 keeps text readable while controlling file size.
    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const jpegBytes = _dataUrlToBytes(jpegDataUrl);
    const embedded = await outDoc.embedJpg(jpegBytes);

    // New page sized to the ORIGINAL page dimensions (scale 1), so the output
    // PDF has correct physical page size; the image just fills it.
    const baseViewport = page.getViewport({ scale: 1 });
    const outPage = outDoc.addPage([baseViewport.width, baseViewport.height]);
    outPage.drawImage(embedded, {
      x: 0, y: 0,
      width: baseViewport.width,
      height: baseViewport.height,
    });
  }

  return await outDoc.save();
}

/* Convert a data: URL to a Uint8Array of its decoded bytes. */
function _dataUrlToBytes(dataUrl){
  const base64 = dataUrl.split(',')[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/* ── DOCX text extraction via mammoth ────────────────────────────────────── */
async function extractDOCXText(file){
  if(typeof mammoth==='undefined')throw new Error('mammoth.js not loaded — please reload.');
  const ab=await file.arrayBuffer();
  const result=await mammoth.extractRawText({arrayBuffer:ab});
  if(!result.value||!result.value.trim())throw new Error('Could not extract text from this DOCX file.');
  return result.value;
}

/* ── PII scanning ────────────────────────────────────────────────────────── */
// Common phrases that look like names but aren't (CV headers, document labels)
const NAME_BLOCKLIST = new Set([
  'curriculum vitae','curriculum vitæ','résumé','resume','cv','personal details',
  'personal information','contact details','contact information','about me',
  'profile','professional summary','executive summary','biography','bio',
  'work experience','werkervaring','opleiding','opleidingen','education',
  'skills','vaardigheden','talen','languages','interesses','hobbies','interests',
  'references','referenties','personalia','contact',
]);

/* ── Positional name detection ───────────────────────────────────────────── */
/* Finds the candidate's name by visual position on page 1, not extraction order.
   Templates (Canva, etc.) often extract sidebar text BEFORE the header containing
   the name. Regex anchored at document start fails for those. This function
   searches the visually-topmost lines of page 1 for name-shaped content.
   Returns an array of {value, items} objects suitable for direct redaction. */
function findNameByPosition(items) {
  if (!items || items.length === 0) return [];
  // Page 1 only — names live there. Drop everything else.
  const p1 = items.filter(it => it.pageNum === 1);
  if (p1.length === 0) return [];

  // Group items by line (same Y within ~3pt). PDF Y is bottom-up.
  const lineMap = new Map();
  for (const it of p1) {
    const yKey = Math.round(it.y / 3) * 3; // 3pt buckets
    if (!lineMap.has(yKey)) lineMap.set(yKey, []);
    lineMap.get(yKey).push(it);
  }

  // Build "visual lines" — items at same Y but with large X gaps are distinct
  // visual columns/blocks (e.g. a label "Naam:" and the value "Roethof, Carlos"
  // separated by 100+ points of whitespace). Split those into separate lines.
  const lines = [];
  for (const [y, its] of lineMap.entries()) {
    its.sort((a, b) => a.x - b.x);
    let chunk = [its[0]];
    for (let i = 1; i < its.length; i++) {
      const prev = its[i - 1];
      const cur = its[i];
      const gap = cur.x - (prev.x + prev.w);
      // Gap > 30pt = visually distinct block (typical padding is <10pt)
      if (gap > 30) {
        // Flush current chunk as a line, start new one
        const text = chunk.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
        if (text.length >= 2) {
          const avgH = chunk.reduce((s, i) => s + (i.h || 10), 0) / chunk.length;
          lines.push({ y, text, items: chunk.slice(), fontSize: avgH });
        }
        chunk = [cur];
      } else {
        chunk.push(cur);
      }
    }
    // Flush final chunk
    const text = chunk.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
    if (text.length >= 2) {
      const avgH = chunk.reduce((s, i) => s + (i.h || 10), 0) / chunk.length;
      lines.push({ y, text, items: chunk.slice(), fontSize: avgH });
    }
  }

  // Sort lines top-to-bottom (highest Y = top of page in PDF coords)
  lines.sort((a, b) => b.y - a.y);
  if (lines.length === 0) return [];

  // We look at the top N lines. N=10 is generous — accounts for templates that
  // stack a tagline, banner, "Curriculum Vitae" header, etc. above the name.
  const topLines = lines.slice(0, 10);

  // What "looks like a name"? A line of 2-4 capitalized words, alphabetic only,
  // total 4-60 chars, no digits/punctuation other than spaces/hyphens/commas/dots.
  // REQUIRES at least 2 words — single-word matches are too unreliable
  // (could be section headers, job titles, etc.). Multi-line names are handled
  // separately below.
  const looksLikeName = (text) => {
    if (text.length < 4 || text.length > 60) return false;
    if (/[0-9@:/]/.test(text)) return false; // digits/email/url indicators
    if (NAME_BLOCKLIST.has(text.toLowerCase())) return false;
    // Allow letters (incl. accented), spaces, hyphens, single comma, single period
    if (!/^[A-Za-zÀ-ÿ' .,\-]+$/.test(text)) return false;
    // Strip trailing comma/period for word counting
    const cleaned = text.replace(/[,.]+$/g, '').trim();
    // Split on commas-with-spaces or just whitespace
    const words = cleaned.split(/[, ]+/).filter(w => w.length > 0);
    if (words.length < 2 || words.length > 4) return false;
    // Each word: at least 2 chars, starts with uppercase or is fully uppercase
    for (const w of words) {
      if (w.length < 2) return false;
      // Allow particles like "del", "van", "von" (lowercase) only if NOT first word
      if (w === w.toLowerCase() && w.length > 4) return false;
      const first = w[0];
      if (first !== first.toUpperCase()) return false;
    }
    return true;
  };

  // Scan top lines for the FIRST one that looks like a name.
  // Also handles multi-line names (Kevin/Nlandu — single capitalized word on
  // each of two consecutive lines at similar X).
  const results = [];

  for (let i = 0; i < topLines.length; i++) {
    const line = topLines[i];
    const text = line.text;

    // Single-line name match (2+ words)
    if (looksLikeName(text)) {
      results.push({ value: text, items: line.items.slice() });
      break;
    }

    // Multi-line name: this line is one capitalized word, next visible line is
    // also one capitalized word, similar X start, similar font size.
    if (i + 1 < topLines.length) {
      const nextLine = topLines[i + 1];
      const oneWord = /^[A-Z][a-zA-ZÀ-ÿ\-]{2,30}$/;
      if (oneWord.test(text) && oneWord.test(nextLine.text)) {
        // Same X start (within ~10pt) and Y gap reasonable (within ~3 line heights)
        const x1 = line.items[0].x;
        const x2 = nextLine.items[0].x;
        const yGap = line.y - nextLine.y;
        const lh = Math.max(line.fontSize, nextLine.fontSize);
        if (Math.abs(x1 - x2) <= 15 && yGap > 0 && yGap <= lh * 3) {
          if (!NAME_BLOCKLIST.has(text.toLowerCase()) &&
              !NAME_BLOCKLIST.has(nextLine.text.toLowerCase())) {
            results.push({
              value: text + ' ' + nextLine.text,
              items: [...line.items, ...nextLine.items],
            });
            break;
          }
        }
      }
    }
  }

  return results;
}

function scanForPII(text,activeKeys,items){
  const found=[],seen=new Set();

  // Positional name detection — runs first because it's the most reliable for
  // template-based CVs. Adds names found visually at the top of page 1.
  if (activeKeys.name && items && items.length > 0) {
    const positionalNames = findNameByPosition(items);
    for (const n of positionalNames) {
      const dk = 'NAME:' + n.value.toLowerCase();
      if (seen.has(dk)) continue;
      seen.add(dk);
      found.push({
        type: 'NAME',
        label: 'Full name (positional)',
        value: n.value,
        conf: 'high',
        // Pass items so the position finder can short-circuit string search
        prelocated: n.items,
      });
    }
  }

  for(const pattern of PII_PATTERNS){
    if(!activeKeys[pattern.key])continue;
    const re=new RegExp(pattern.re.source,pattern.re.flags);
    // Defensive: a pattern without /g flag will infinite-loop in re.exec.
    // We force /g on every pattern to be safe regardless of how it was declared.
    if(!re.flags.includes('g')){
      console.warn('PII pattern missing /g flag, this is a bug:', pattern.type);
      continue;
    }
    // Some patterns (e.g. multi-line name) are restricted to the start of the document
    const searchSpace = pattern.limit ? text.slice(0, pattern.limit) : text;
    let match;
    let safetyCounter = 0;
    while((match=re.exec(searchSpace))!==null){
      // Guard against pathological infinite loops (zero-width matches or bugs).
      if(++safetyCounter > 1000){
        console.warn('Pattern exceeded 1000 matches, breaking:', pattern.type);
        break;
      }
      // For multi-line matches, replace the newline with a space so the position
      // finder treats it as a phrase (it scans line-by-line and across-2-lines).
      let val=match[0].trim();
      if(val.includes('\n'))val=val.replace(/\n+/g,' ');
      if(val.length<2)continue;
      // Skip common CV header phrases that structurally look like names
      if(pattern.type==='NAME' && NAME_BLOCKLIST.has(val.toLowerCase()))continue;
      const dk=pattern.type+':'+val.toLowerCase();
      if(seen.has(dk))continue;
      seen.add(dk);
      found.push({type:pattern.type,label:pattern.label,value:val,conf:pattern.conf});
      // Defensive: if the regex matched zero characters, advance lastIndex manually
      // to prevent an infinite loop on zero-width matches.
      if(match.index === re.lastIndex)re.lastIndex++;
    }
  }
  return found.sort((a,b)=>b.value.length-a.value.length);
}

function applyTextRedactions(text,piiItems){
  let result=text;
  for(const item of piiItems){
    const escaped=item.value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    result=result.replace(new RegExp(escaped,'gi'),'['+item.type+' NULLIFIED]');
  }
  return result;
}

/* ── Preview ─────────────────────────────────────────────────────────────── */
function showPreview(text,piiItems){
  let display=text.slice(0,1600);
  if(text.length>1600)display+='\n\n[... truncated]';
  for(const item of piiItems){
    const escaped=('['+item.type+' NULLIFIED]').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    display=display.replace(new RegExp(escaped,'g'),`<span class="rx" title="${item.label}">████████</span>`);
  }
  $('prevbody').innerHTML=display;$('prev').classList.add('show');
}

function showPIIList(piiItems){
  const list=$('piil');list.innerHTML='';
  $('piict').textContent=piiItems.length+' item'+(piiItems.length!==1?'s':'')+' nullified';
  if(!piiItems.length){
    list.innerHTML='<div style="font-size:11px;color:var(--ink3);text-align:center;padding:10px;">No PII detected with current settings.</div>';
  }else{
    piiItems.forEach(item=>{
      const div=document.createElement('div');div.className='pii-item';div.setAttribute('role','listitem');
      div.innerHTML=`<span class="ptype">${item.type}</span><span class="pval">${esc(item.value)}</span><span class="c${item.conf[0]}">${item.conf}</span>`;
      list.appendChild(div);
    });
  }
  $('piiwrap').classList.add('show');
}

/* ── Downloads ───────────────────────────────────────────────────────────── */
let _redactedPdfBytes=null;

function downloadRedactedPDF(){
  if(!_redactedPdfBytes){downloadRedactedText();return;}
  const baseName=currentFile.name.replace(/\.[^.]+$/,'');
  const blob=new Blob([_redactedPdfBytes],{type:'application/pdf'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=baseName+'_NULLIFIED.pdf';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
}

function downloadRedactedText(){
  const baseName=currentFile.name.replace(/\.[^.]+$/,'');
  const sep='═'.repeat(42);
  const content=['NULLIFYCV — DE-IDENTIFIED DOCUMENT','nullifycv.com',sep,
    'Original file : '+currentFile.name,
    'Processed     : '+new Date().toISOString(),
    'Engine        : pdf.js 3.11.174 + pdf-lib 1.17.1 / mammoth 1.6.0',
    'Transmitted   : 0 bytes',
    'Nullified     : '+detectedPII.length+' PII items',
    sep,'',redactedText].join('\n');
  const blob=new Blob([content],{type:'text/plain;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=baseName+'_NULLIFIED.txt';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
}

function dlAudit(){
  const data=auditData||{tool:'NullifyCV v2.3.1',site:'nullifycv.com',
    timestamp:new Date().toISOString(),file:currentFile?currentFile.name:'none',
    server_transmissions:0,items_nullified:detectedPII.length,
    disclaimer:'Consistent with GDPR Article 5. Not legal advice.'};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='nullifycv_audit_'+Date.now()+'.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
  // Analytics: who downloads the audit log? These are trust-conscious users —
  // the ones who care about verification. Key signal for our differentiation.
  if (window.va) window.va('event', {
    name: 'audit_downloaded',
    mode: currentMode,
    items_nullified: (detectedPII && detectedPII.length) || 0,
  });
}

/* ── Main processing flow ────────────────────────────────────────────────── */
async function go(){
  if(!currentFile)return;clearError();_redactedPdfBytes=null;
  const btn=$('pbtn');btn.disabled=true;
  btn.innerHTML='<div class="spin" style="border-top-color:var(--green-muted);width:11px;height:11px;margin:0;"></div> Nullifying...';
  $('ss').classList.add('show');$('spin').style.display='';

  try{
    const ext=currentFile.name.split('.').pop().toLowerCase();
    const activeKeys=getActiveKeys();

    if(ext==='pdf'){
      /* ── PDF path: extract text+positions, find PII, draw black bars ── */
      setStatus('Extracting text and positions from PDF...',12);
      const {text,items,images,rawBytes,numPages,pageOpCounts,pageCanvases}=await extractPDFData(currentFile);

      setStatus('Scanning for PII...',35);
      await slp(100);
      detectedPII=scanForPII(text,activeKeys,items);
      redactedText=applyTextRedactions(text,detectedPII);

      setStatus('Locating PII coordinates on PDF pages...',55);
      await slp(100);
      const positions=findPIIPositions(items,detectedPII);
      pdfPositions=positions;

      // Gate image redaction on the `photos` key — only active in bias/client/eeoc modes.
      // When photos mode is on AND images were detected, show the picker so the user
      // explicitly selects which images to redact. Heuristic suggests likely photos.
      let imagesToRedact = [];
      let imageFilterReasons = {};
      let pickerSkipped = false;
      let pickerCancelled = false;
      if (activeKeys.photos && images.length > 0) {
        const filtered = filterToLikelyPhotos(images, numPages);
        imageFilterReasons = filtered.rejectedReasons;
        // Show picker; user can override the heuristic
        setStatus('Reviewing detected images...', 60);
        const userSelection = await showImagePicker(images, pageCanvases, filtered.kept);
        if (userSelection === null) {
          // User cancelled — abort the redaction
          pickerCancelled = true;
          setStatus('Cancelled by user', 0);
          $('spin').style.display='none';
          $('pbtn').disabled=false;
          return;
        }
        imagesToRedact = userSelection;
      } else if (activeKeys.photos) {
        // Photos mode is on but no images detected — nothing to do
        const filtered = filterToLikelyPhotos(images, numPages);
        imageFilterReasons = filtered.rejectedReasons;
      } else {
        pickerSkipped = true;
      }

      setStatus('Drawing redaction bars on PDF...',72);
      await slp(100);

      if(positions.length>0 || imagesToRedact.length>0){
        _redactedPdfBytes=await buildRedactedPDF(rawBytes,positions,imagesToRedact);
        const photoNote = imagesToRedact.length > 0
          ? ' + ' + imagesToRedact.length + ' image' + (imagesToRedact.length===1?'':'s')
          : '';
        setStatus('Redacted PDF ready — '+detectedPII.length+' items'+photoNote+' nullified',90);
      }else{
        setStatus('PII found in text — PDF bars could not be placed (complex layout)',90);
      }
      await slp(100);

      showPreview(redactedText,detectedPII);
      showPIIList(detectedPII);
      const completeMsg = imagesToRedact.length > 0
        ? '✓ Complete — '+detectedPII.length+' items + '+imagesToRedact.length+' image'+(imagesToRedact.length===1?'':'s')+' nullified'
        : '✓ Complete — '+detectedPII.length+' items nullified';
      setStatus(completeMsg,100);
      if(window.markBytesVerified)markBytesVerified();
      $('spin').style.display='none';
      // Analytics: processing completed successfully
      if (window.va) window.va('event', {
        name: 'file_processed',
        format: 'pdf',
        mode: currentMode,
        items_nullified: detectedPII.length,
        photos_redacted: imagesToRedact.length,
      });

      // ── Photo warning banner ─────────────────────────────────────────────
      // If photos were detected but not redacted (standard mode), warn the user.
      // This is a credibility issue — many CVs include photos that the user
      // probably wants removed.
      if (images.length > 0 && !activeKeys.photos) {
        showPhotoWarning(images.length);
      } else {
        hidePhotoWarning();
      }

      auditData={tool:'NullifyCV v2.3.1',site:'nullifycv.com',
        report_id:'NCV-'+Date.now(),timestamp:new Date().toISOString(),
        file:currentFile.name,file_size_bytes:currentFile.size,
        processing_engine:'pdf.js@3.11.174 + pdf-lib@1.17.1',
        output_format:_redactedPdfBytes?'redacted PDF (black bars)':'plain text',
        server_transmissions:0,
        items_nullified:detectedPII.length,
        images_nullified:imagesToRedact.length,
        images_detected:images.length,
        image_detection_diagnostics:{
          per_page_op_counts: pageOpCounts,
          images_by_source: images.reduce((acc,img)=>{
            acc[img.source||'unknown']=(acc[img.source||'unknown']||0)+1;
            return acc;
          },{}),
          images_filtered_out: images.length - imagesToRedact.length,
          filter_rejection_reasons: imageFilterReasons,
        },
        redaction_positions:positions.length,
        position_finder_diagnostics: positions._diagnostics || null,
        active_redaction_keys:Object.keys(activeKeys),
        items:detectedPII.map(p=>({type:p.type,label:p.label,confidence:p.conf})),
        disclaimer:'Consistent with GDPR Article 5. Not legal advice.'};

      // Download redacted PDF if we have it, otherwise text
      setTimeout(()=>{
        if(_redactedPdfBytes)downloadRedactedPDF();
        else downloadRedactedText();
      },400);

      btn.disabled=false;
      if(_redactedPdfBytes){
        btn.innerHTML='<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 2v7M4 6l3 3 3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="2" y1="12" x2="12" y2="12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg> Download redacted PDF';
        btn.onclick=downloadRedactedPDF;
      }else{
        btn.innerHTML='Download text version';
        btn.onclick=downloadRedactedText;
      }

    }else{
      /* ── DOCX path: extract text, redact, output clean text ── */
      setStatus('Extracting text from DOCX...',20);
      const text=await extractDOCXText(currentFile);
      setStatus('Scanning for PII...',45);await slp(150);
      detectedPII=scanForPII(text,activeKeys);
      setStatus('Nullifying '+detectedPII.length+' items...',68);await slp(120);
      redactedText=applyTextRedactions(text,detectedPII);
      setStatus('Generating output...',88);await slp(100);
      showPreview(redactedText,detectedPII);showPIIList(detectedPII);
      setStatus('✓ Complete — '+detectedPII.length+' items nullified',100);if(window.markBytesVerified)markBytesVerified();
      $('spin').style.display='none';
      // Analytics: processing completed successfully
      if (window.va) window.va('event', {
        name: 'file_processed',
        format: 'docx',
        mode: currentMode,
        items_nullified: detectedPII.length,
      });

      auditData={tool:'NullifyCV v2.3.1',site:'nullifycv.com',
        report_id:'NCV-'+Date.now(),timestamp:new Date().toISOString(),
        file:currentFile.name,processing_engine:'mammoth@1.6.0',
        server_transmissions:0,items_nullified:detectedPII.length,
        disclaimer:'Consistent with GDPR Article 5. Not legal advice.'};

      setTimeout(downloadRedactedText,400);
      btn.disabled=false;
      btn.innerHTML='Download again';btn.onclick=downloadRedactedText;
    }

    $('pad').classList.add('show');
    $('padok').textContent='✓ '+detectedPII.length+' items nullified — 0 bytes transmitted to any server.';

  }catch(err){
    console.error('[NullifyCV]',err);showError(err.message);setStatus('Error',0);
    $('spin').style.display='none';btn.disabled=false;btn.innerHTML='Retry';btn.onclick=go;
  }
}

document.addEventListener('DOMContentLoaded',()=>{
  initPdfJs();
  document.querySelectorAll('.tcard').forEach(card=>{
    card.addEventListener('keydown',e=>{
      if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleCard(card);}
    });
  });
  // Licence system init
  if (!checkURLLicence()) {
    loadStoredLicence();
  }
  // Init batch UI (shows only for pro/team)
  initBatchUI();
  // Initialize the batch mode banner with the default mode
  updateBatchModeBanner();
  // Bytes counter — stays at 0, proves nothing is transmitted
  const bc = document.getElementById('bytes-counter');
  if (bc) {
    // Intercept fetch to count bytes — always 0 for document data
    const origFetch = window.fetch;
    window.fetch = function(...args) {
      // Document processing never calls fetch — only CDN scripts do on load
      return origFetch.apply(this, args);
    };
    // Keep counter at 0 and pulse it after processing to draw attention
    window.markBytesVerified = function() {
      if (bc) { bc.style.color = 'var(--green-mid)'; bc.style.fontWeight = '700'; }
    };
  }
});

/* ── Upgrade modal ────────────────────────────────────────────────────────── */
const UPGRADE_COPY = {
  mode: {
    title: 'Unlock advanced redaction modes',
    desc:  'Bias Strip removes school names, graduation years and pronouns. Client Sub. protects candidate contact details before forwarding to clients. EEOC mode applies full blind review redaction. Unlock with the $4.99 Week Pass — unlimited use for 7 days.'
  },
  target: {
    title: 'Unlock additional redaction targets',
    desc:  'School names, gender pronouns, LinkedIn URLs and file metadata are paid targets. They remove prestige bias, gender signals and hidden author data from your CV. Unlock with the $4.99 Week Pass — one-time, no subscription, no auto-renewal.'
  }
};

// Track whether the most recently shown upgrade modal led to a checkout click.
// If the modal closes without a click on a Stripe link, we record dismissal.
// The flag is window-scoped because the checkout_click handler lives in
// index.html (it runs on every link site-wide, not just from the modal).
let _upgradeModalOpenTrigger = null;

function showUpgrade(type) {
  const copy = UPGRADE_COPY[type] || UPGRADE_COPY.mode;
  document.getElementById('upgrade-title').textContent = copy.title;
  document.getElementById('upgrade-desc').textContent  = copy.desc;
  document.getElementById('upgrade-overlay').style.display = 'block';
  document.getElementById('upgrade-modal').style.display   = 'block';
  // Analytics: how often does the upgrade modal appear?
  // Pairs with checkout_click to measure modal → checkout conversion.
  _upgradeModalOpenTrigger = type;
  window._upgradeModalCheckoutClicked = false;
  if (window.va) window.va('event', { name: 'upgrade_modal_shown', trigger: type });
}

function closeUpgrade() {
  document.getElementById('upgrade-overlay').style.display = 'none';
  document.getElementById('upgrade-modal').style.display   = 'none';
  // Analytics: modal dismissed without checkout click — the implicit "no thanks".
  // If most modals get dismissed, the offer or copy needs work.
  if (window.va && _upgradeModalOpenTrigger && !window._upgradeModalCheckoutClicked) {
    window.va('event', { name: 'upgrade_modal_dismissed', trigger: _upgradeModalOpenTrigger });
  }
  _upgradeModalOpenTrigger = null;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeUpgrade();
});

/* ── NullifyCV Licence Key System ─────────────────────────────────────────────
   Move 2 (June 2026): localStorage entries are no longer trusted. The licence
   stored under 'ncv_licence_v2' is a {payload, signature} object issued by
   /api/issue-licence after Stripe verifies the purchase. On every page load,
   we send the stored licence to /api/validate-licence, which recomputes the
   HMAC-SHA256 signature server-side and rejects forgeries.

   Legacy 'ncv_licence' entries (pre-Move-2, unsigned) are ignored and removed.
   There are no production-paying customers to migrate.
   ─────────────────────────────────────────────────────────────────────────── */

let activeLicence = null;

/* ── Load and validate stored licence on page load ────────────────────────── */
async function loadStoredLicence() {
  // Clean up any legacy unsigned licence — it cannot be trusted under the new model
  try {
    if (localStorage.getItem('ncv_licence')) {
      localStorage.removeItem('ncv_licence');
    }
  } catch (e) {}

  // Read the signed licence
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem('ncv_licence_v2') || 'null');
  } catch (e) {
    return false;
  }
  if (!stored || !stored.payload || !stored.signature) return false;

  // Fast local expiry check before hitting the server. This is purely a UX
  // optimisation — we still validate with the server below, which is authoritative.
  if (typeof stored.payload.expires === 'number' && stored.payload.expires <= Date.now()) {
    try { localStorage.removeItem('ncv_licence_v2'); } catch (e) {}
    return false;
  }

  // Validate signature server-side. A forged localStorage entry will fail here.
  try {
    const r = await fetch('/api/validate-licence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: stored.payload, signature: stored.signature }),
    });
    const result = await r.json();

    if (r.ok && result.valid === true) {
      activeLicence = {
        tier: result.tier,
        plan: result.plan,
        expires: result.expires,
      };
      applyLicence(result.tier);
      showLicenceStatus(activeLicence);
      return true;
    }

    // Invalid signature OR expired OR malformed — drop it so a stale entry
    // can't keep failing validation on every load.
    try { localStorage.removeItem('ncv_licence_v2'); } catch (e) {}
    return false;
  } catch (e) {
    // Network error talking to /api/validate-licence. We deliberately fail
    // CLOSED here — if we can't verify, we don't unlock. The user can refresh.
    console.warn('[NullifyCV] Licence validation network error:', e);
    return false;
  }
}

/* ── Apply licence — unlock features ── */
function applyLicence(tier) {
  activeLicence = { tier };
  const isSeeker = ['seeker','pro','team'].includes(tier);
  const isPro    = ['pro','team'].includes(tier);

  // Unlock mode tabs
  document.querySelectorAll('.tab-locked').forEach(tab => {
    tab.classList.remove('tab-locked');
    const txt = tab.textContent.replace(' 🔒','').trim();
    tab.textContent = txt;
    if (txt === 'Bias strip') tab.onclick = function(){ setMode('bias', this); };
    if (txt === 'Client sub.') tab.onclick = function(){ setMode('client', this); };
    if (txt === 'EEOC') tab.onclick = function(){ setMode('eeoc', this); };
  });

  // Unlock target cards
  document.querySelectorAll('.tcard-locked').forEach(card => {
    card.classList.remove('tcard-locked');
    card.querySelector('.tbox').textContent = '';
    card.onclick = function(){ toggleCard(this); };
  });

  // Update licence input area
  const licBox = document.getElementById('licence-box');
  if (licBox) licBox.style.display = 'none';
  // Show batch UI for pro/team
  initBatchUI();
}

/* ── Show licence status bar ── */
function showLicenceStatus(licence) {
  const bar = document.getElementById('licence-status');
  if (!bar) return;
  const expDate = new Date(licence.expires).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  const tierLabel = licence.tier === 'pro' ? 'Pro' : licence.tier === 'team' ? 'Team' : 'Job Seeker';
  bar.innerHTML = `<span style="color:var(--green-mid)">✓</span> ${tierLabel} plan active — expires ${expDate} · <a href="/pro.html" style="color:var(--green-muted);text-decoration:underline;font-size:11px;">upgrade</a>`;
  bar.style.display = 'flex';
}

/* ── Activate key from input field ── */
async function activateLicenceKey() {
  // Under Move 2 (June 2026), licences are signed by the server and issued only
  // after a successful Stripe checkout. There is no way for a user to manually
  // type in a key and gain access — doing so would be a forgery vector. If a
  // user lost their localStorage (e.g. switched browsers), the recovery path
  // is to contact support and have us re-issue. Move 3 will automate this via
  // an email lookup against Stripe; for now, support is the channel.
  const err = document.getElementById('licence-err');
  if (err) {
    err.innerHTML = 'Manual key entry has been replaced with a more secure system. ' +
                    'If you lost access to your purchase, please email ' +
                    '<a href="mailto:support@nullifycv.com?subject=Restore%20access" style="color:inherit;text-decoration:underline;">support@nullifycv.com</a> ' +
                    'with your Stripe receipt — we will restore your access within 24 hours.';
  }
}

/* ── Check URL for auto-activation from success page ── */
function checkURLLicence() {
  const params    = new URLSearchParams(window.location.search);
  const activated = params.get('activated');
  if (activated) {
    // Fire and forget — loadStoredLicence is async, but UI updates happen
    // inside applyLicence/showLicenceStatus once validation completes.
    loadStoredLicence();
    window.history.replaceState({}, '', '/');
    return true;
  }
  return false;
}





/* ══════════════════════════════════════════════════════════════════════════ */
/* ── BATCH PROCESSING (Pro / Team only) ─────────────────────────────────── */
/* ══════════════════════════════════════════════════════════════════════════ */

let batchQueue   = [];   // Array of File objects
let batchRunning = false;

/* ── Show / hide batch UI based on licence tier ── */
function initBatchUI() {
  const tier = activeLicence ? activeLicence.tier : null;
  const batchSection = document.getElementById('batch-section');
  if (!batchSection) return;
  if (tier === 'pro' || tier === 'team') {
    batchSection.style.display = 'block';
  } else {
    batchSection.style.display = 'none';
  }
}

/* ── Add files to batch queue ── */
function batchAddFiles(files) {
  const allowed = ['pdf','docx','doc'];
  let added = 0;
  for (const file of files) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!allowed.includes(ext)) continue;
    if (batchQueue.length >= 200) { batchShowError('Maximum 200 files per batch.'); break; }
    // Avoid duplicates
    if (batchQueue.find(f => f.name === file.name && f.size === file.size)) continue;
    batchQueue.push(file);
    added++;
  }
  batchRenderQueue();
  if (added > 0) document.getElementById('batch-run-btn').disabled = false;
}

/* ── Render the queue list ── */
function batchRenderQueue() {
  const list  = document.getElementById('batch-list');
  const count = document.getElementById('batch-count');
  if (!list) return;

  count.textContent = batchQueue.length + ' file' + (batchQueue.length !== 1 ? 's' : '') + ' queued';
  list.innerHTML = '';

  batchQueue.forEach((file, i) => {
    const row = document.createElement('div');
    row.className = 'batch-row';
    row.id = 'brow-' + i;
    row.innerHTML = `
      <span class="batch-row-icon">${file.name.endsWith('.pdf') ? '📄' : '📝'}</span>
      <span class="batch-row-name">${esc(file.name)}</span>
      <span class="batch-row-size">${fmtSize(file.size)}</span>
      <span class="batch-row-status" id="bstat-${i}">queued</span>
      <button class="batch-row-del" onclick="batchRemove(${i})" aria-label="Remove">×</button>
    `;
    list.appendChild(row);
  });
}

/* ── Remove a file from queue ── */
function batchRemove(i) {
  batchQueue.splice(i, 1);
  batchRenderQueue();
  if (batchQueue.length === 0) document.getElementById('batch-run-btn').disabled = true;
}

function batchClear() {
  batchQueue = [];
  batchRenderQueue();
  document.getElementById('batch-run-btn').disabled = true;
  document.getElementById('batch-dl-btn').style.display = 'none';
  document.getElementById('batch-progress-wrap').style.display = 'none';
  batchShowError('');
}

function batchShowError(msg) {
  const el = document.getElementById('batch-err');
  if (el) el.textContent = msg;
}

/* ── Process single file for batch (returns {name, bytes|text, piiCount}) ── */
async function batchProcessFile(file, activeKeys) {
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'pdf') {
    const { text, items, images, rawBytes, numPages } = await extractPDFData(file);
    const pii       = scanForPII(text, activeKeys, items);
    const positions = findPIIPositions(items, pii);

    // Photos: in batch mode there's no per-file picker (impractical for 100+ files).
    // We use the heuristic filter to identify likely profile photos. Trade-off:
    // dramatically faster than picker workflow, but may produce false positives
    // on template-heavy CVs (Canva-style decorative shapes). For sensitive cases,
    // users can re-process individual files via the single-file flow which has the picker.
    let imagesToRedact = [];
    let imagesNullified = 0;
    if (activeKeys.photos && images && images.length > 0) {
      const filtered = filterToLikelyPhotos(images, numPages);
      imagesToRedact = filtered.kept;
      imagesNullified = imagesToRedact.length;
    }

    let outBytes = rawBytes;
    if (positions.length > 0 || imagesToRedact.length > 0) {
      outBytes = await buildRedactedPDF(rawBytes, positions, imagesToRedact);
    }
    return {
      name: file.name.replace(/\.pdf$/i, '_NULLIFIED.pdf'),
      bytes: outBytes,
      piiCount: pii.length,
      imagesNullified,
      imagesDetected: images ? images.length : 0,
      positionFinderDiagnostics: positions._diagnostics || null,
      type: 'pdf'
    };

  } else {
    const text    = await extractDOCXText(file);
    const pii     = scanForPII(text, activeKeys);
    const redacted = applyTextRedactions(text, pii);
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const sep      = '═'.repeat(42);
    const content  = ['NULLIFYCV — DE-IDENTIFIED DOCUMENT', 'nullifycv.com', sep,
      'Original file : ' + file.name,
      'Processed     : ' + new Date().toISOString(),
      'Engine        : mammoth 1.6.0',
      'Transmitted   : 0 bytes',
      'Nullified     : ' + pii.length + ' PII items',
      sep, '', redacted].join('\n');
    return { name: baseName + '_NULLIFIED.txt', bytes: new TextEncoder().encode(content), piiCount: pii.length, type: 'docx' };
  }
}

/* ── Run the batch ── */
async function batchRun() {
  if (batchRunning || batchQueue.length === 0) return;
  batchRunning = true;
  batchShowError('');

  const runBtn   = document.getElementById('batch-run-btn');
  const dlBtn    = document.getElementById('batch-dl-btn');
  const progWrap = document.getElementById('batch-progress-wrap');
  const progBar  = document.getElementById('batch-progress-bar');
  const progTxt  = document.getElementById('batch-progress-txt');

  runBtn.disabled  = true;
  runBtn.textContent = 'Processing...';
  progWrap.style.display = 'block';
  dlBtn.style.display    = 'none';

  const activeKeys = getActiveKeys();
  const results    = [];
  const auditItems = [];
  let   errors     = 0;

  for (let i = 0; i < batchQueue.length; i++) {
    const file   = batchQueue[i];
    const statEl = document.getElementById('bstat-' + i);
    const rowEl  = document.getElementById('brow-' + i);

    if (statEl) statEl.textContent = 'processing...';
    if (statEl) statEl.style.color = 'var(--green-muted)';

    const pct = Math.round(((i) / batchQueue.length) * 100);
    progBar.style.width = pct + '%';
    progTxt.textContent = (i + 1) + ' of ' + batchQueue.length + ' — ' + file.name;

    try {
      const result = await batchProcessFile(file, activeKeys);
      results.push(result);
      const auditEntry = { file: file.name, pii_nullified: result.piiCount, status: 'success' };
      if (typeof result.imagesNullified === 'number') {
        auditEntry.images_nullified = result.imagesNullified;
        auditEntry.images_detected = result.imagesDetected;
      }
      if (result.positionFinderDiagnostics) {
        auditEntry.position_finder = result.positionFinderDiagnostics;
      }
      auditItems.push(auditEntry);
      if (statEl) {
        const photoNote = result.imagesNullified > 0
          ? ' + ' + result.imagesNullified + ' image' + (result.imagesNullified === 1 ? '' : 's')
          : '';
        statEl.textContent = '✓ ' + result.piiCount + ' items' + photoNote;
        statEl.style.color = 'var(--green-mid)';
      }
      if (rowEl)  rowEl.style.opacity = '0.7';
    } catch (err) {
      errors++;
      auditItems.push({ file: file.name, pii_nullified: 0, status: 'error', error: err.message });
      if (statEl) { statEl.textContent = '✗ error'; statEl.style.color = '#c0392b'; }
      console.error('[Batch]', file.name, err);
    }

    await slp(50); // Small pause to keep UI responsive
  }

  progBar.style.width = '100%';
  progTxt.textContent = '✓ Complete — ' + results.length + ' files processed' + (errors > 0 ? ', ' + errors + ' errors' : '');

  // Build ZIP using JSZip
  if (results.length > 0) {
    try {
      if (typeof JSZip === 'undefined') {
        batchShowError('JSZip not loaded — please reload the page.');
        batchRunning = false;
        return;
      }

      const zip = new JSZip();

      // Add all redacted files
      results.forEach(r => {
        zip.file(r.name, r.bytes);
      });

      // Add combined audit log
      // Detect active mode name
      const activeModeName = (() => {
        const tabs = document.querySelectorAll('.tab.on');
        for (const t of tabs) {
          const txt = t.textContent.trim().toLowerCase();
          if (txt.includes('bias')) return 'Bias Strip';
          if (txt.includes('client')) return 'Client Submission';
          if (txt.includes('eeoc')) return 'EEOC Blind Review';
        }
        return 'Standard PII';
      })();

      const auditLog = {
        tool: 'NullifyCV v2.3.1',
        site: 'nullifycv.com',
        batch_id: 'BATCH-' + Date.now(),
        timestamp: new Date().toISOString(),
        redaction_mode: activeModeName,
        total_files: batchQueue.length,
        processed: results.length,
        errors,
        server_transmissions: 0,
        active_keys: Object.keys(activeKeys),
        notes: activeKeys.photos
          ? 'Batch mode redacts photos using a heuristic filter (no per-file picker). For tricky cases, re-process individual files via the single-file flow which has the image picker.'
          : 'Standard mode keeps photos. Switch to Bias Strip, Client Submission, or EEOC Blind Review to remove photos.',
        files: auditItems,
        disclaimer: 'Consistent with GDPR Article 5. Not legal advice.'
      };
      zip.file('nullifycv_batch_audit.json', JSON.stringify(auditLog, null, 2));

      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const zipUrl  = URL.createObjectURL(zipBlob);

      dlBtn.style.display = 'inline-block';
      dlBtn.onclick = () => {
        const a = document.createElement('a');
        a.href = zipUrl;
        a.download = 'NullifyCV_Batch_' + new Date().toISOString().slice(0,10) + '.zip';
        a.click();
      };
      setTimeout(() => URL.revokeObjectURL(zipUrl), 60000);

    } catch (zipErr) {
      batchShowError('Error creating ZIP: ' + zipErr.message);
      console.error('[Batch ZIP]', zipErr);
    }
  }

  runBtn.textContent = 'Run batch again';
  runBtn.disabled    = false;
  batchRunning       = false;
}

/* ── Drag and drop for batch zone ── */
function batchDov(e) { e.preventDefault(); document.getElementById('batch-drop').classList.add('over'); }
function batchDdr(e) {
  e.preventDefault();
  document.getElementById('batch-drop').classList.remove('over');
  if (e.dataTransfer.files.length > 0) batchAddFiles(Array.from(e.dataTransfer.files));
}
function batchFsel(e) {
  if (e.target.files.length > 0) batchAddFiles(Array.from(e.target.files));
}
