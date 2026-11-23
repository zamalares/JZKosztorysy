import { formatPLN, parseDiscount } from './estimate-editor.js';

const PDFMAKE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/pdfmake.min.js';
const VFS_FONTS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/vfs_fonts.min.js';

let pdfMakeLoaderPromise = null;
let cachedLogoDataUrl = undefined; // undefined = jeszcze nie sprawdzono, null = brak pliku

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Nie udało się załadować: ${src}`)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`Nie udało się załadować: ${src}`));
    document.head.appendChild(script);
  });
}

async function ensurePdfMake() {
  if (window.pdfMake && window.pdfMake.createPdf) {
    return window.pdfMake;
  }
  if (!pdfMakeLoaderPromise) {
    pdfMakeLoaderPromise = (async () => {
      await loadScript(PDFMAKE_CDN);
      await loadScript(VFS_FONTS_CDN);
      if (!window.pdfMake) {
        throw new Error('Biblioteka pdfMake nie została zainicjalizowana.');
      }
      return window.pdfMake;
    })();
  }
  return pdfMakeLoaderPromise;
}

async function getLogoDataUrl() {
  if (cachedLogoDataUrl !== undefined) {
    return cachedLogoDataUrl;
  }
  try {
    const res = await fetch('assets/logo.png', { cache: 'no-cache' });
    if (!res.ok) {
      cachedLogoDataUrl = null;
      return null;
    }
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    cachedLogoDataUrl = typeof dataUrl === 'string' ? dataUrl : null;
    return cachedLogoDataUrl;
  } catch {
    cachedLogoDataUrl = null;
    return null;
  }
}

function formatDatePL(isoStr) {
  if (!isoStr) return '—';
  const parts = String(isoStr).split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return isoStr;
}

function sanitizeFileName(name) {
  return String(name || 'Kosztorys')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 _-]+/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

export async function generateEstimatePdf(estimate) {
  const pdfMake = await ensurePdfMake();
  const logoDataUrl = await getLogoDataUrl();

  const items = Array.isArray(estimate.items) ? estimate.items : [];

  // Budowanie wierszy tabeli
  const tableBody = [
    [
      { text: 'Lp.', style: 'th', alignment: 'center' },
      { text: 'Usługa', style: 'th' },
      { text: 'Jednostka', style: 'th', alignment: 'center' },
      { text: 'Ilość', style: 'th', alignment: 'right' },
      { text: 'Cena', style: 'th', alignment: 'right' },
      { text: 'Rabat', style: 'th', alignment: 'right' },
      { text: 'Łączna cena', style: 'th', alignment: 'right' }
    ]
  ];

  let lp = 0;
  let grossBeforeGlobal = 0;
  let runningSubtotal = 0;

  items.forEach((item) => {
    if (item.type === 'separator') {
      runningSubtotal = 0;
      tableBody.push([
        {
          colSpan: 7,
          text: item.label ? `— ${item.label} —` : '',
          alignment: 'center',
          fontSize: 8.5,
          bold: true,
          color: '#333333',
          fillColor: '#f3f4f6',
          margin: [0, 3, 0, 3]
        },
        {}, {}, {}, {}, {}, {}
      ]);
      return;
    }

    if (item.type === 'subtotal') {
      const subLabel = item.label || 'Suma częściowa';
      const subValue = runningSubtotal;
      runningSubtotal = 0;

      // ~20% szarego tła (#cccccc) z czarnym tekstem
      tableBody.push([
        {
          colSpan: 6,
          text: subLabel,
          bold: true,
          color: '#000000',
          fillColor: '#cccccc',
          alignment: 'right',
          margin: [0, 3, 6, 3]
        },
        {}, {}, {}, {}, {},
        {
          text: formatPLN(subValue),
          bold: true,
          color: '#000000',
          fillColor: '#cccccc',
          alignment: 'right',
          margin: [0, 3, 0, 3]
        }
      ]);
      return;
    }

    // Pozycja usługi lub "Inne"
    lp += 1;
    const qty = Math.max(0, Math.floor(Number(item.qty) || 0));
    const unitPrice = Number(item.price) || 0;
    const lineGross = qty * unitPrice;
    const { discountAmount, label: discountLabel } = parseDiscount(item.discount, lineGross);
    const lineNet = Math.max(0, lineGross - discountAmount);

    grossBeforeGlobal += lineNet;
    runningSubtotal += lineNet;

    const hasNote = Boolean(item.note && item.note.trim());

    tableBody.push([
      {
        text: `${lp}.`,
        alignment: 'center',
        border: hasNote ? [true, true, true, false] : [true, true, true, true]
      },
      {
        text: item.name || 'Pozycja bez nazwy',
        bold: true,
        border: hasNote ? [true, true, true, false] : [true, true, true, true]
      },
      {
        text: item.unit || 'usł.',
        alignment: 'center',
        border: hasNote ? [true, true, true, false] : [true, true, true, true]
      },
      {
        text: String(qty),
        alignment: 'right',
        border: hasNote ? [true, true, true, false] : [true, true, true, true]
      },
      {
        text: formatPLN(unitPrice),
        alignment: 'right',
        border: hasNote ? [true, true, true, false] : [true, true, true, true]
      },
      {
        text: discountLabel || '—',
        alignment: 'right',
        border: hasNote ? [true, true, true, false] : [true, true, true, true]
      },
      {
        text: formatPLN(lineNet),
        bold: true,
        alignment: 'right',
        border: hasNote ? [true, true, true, false] : [true, true, true, true]
      }
    ]);

    // Wcięty wiersz notatek bezpośrednio pod pozycją
    if (hasNote) {
      tableBody.push([
        {
          text: '',
          border: [true, false, true, true]
        },
        {
          colSpan: 6,
          text: `↳ ${item.note.trim()}`,
          fontSize: 8.5,
          italics: true,
          color: '#222222',
          margin: [14, 0, 0, 2],
          border: [true, false, true, true]
        },
        {}, {}, {}, {}, {}
      ]);
    }
  });

  const { discountAmount: globalDiscountAmt, label: globalDiscountLabel } = parseDiscount(
    estimate.globalDiscount,
    grossBeforeGlobal
  );
  const finalTotal = Math.max(0, grossBeforeGlobal - globalDiscountAmt);

  // Prawa kolumna nagłówka (logo + ramka Dla / Ważna od / Ważna do)
  const rightHeaderStack = [];
  if (logoDataUrl) {
    rightHeaderStack.push({
      image: logoDataUrl,
      fit: [145, 58],
      alignment: 'right',
      margin: [0, 0, 0, 8]
    });
  } else {
    rightHeaderStack.push({
      text: 'JZ PRODUCTION',
      fontSize: 15,
      bold: true,
      alignment: 'right',
      margin: [0, 0, 0, 8]
    });
  }

  rightHeaderStack.push({
    table: {
      widths: [68, '*'],
      body: [
        [
          { text: 'Dla:', bold: true, fillColor: '#f3f4f6' },
          { text: estimate.client || '—', bold: true }
        ],
        [
          { text: 'Ważna od:', bold: true, fillColor: '#f3f4f6' },
          { text: formatDatePL(estimate.validFrom) }
        ],
        [
          { text: 'Ważna do:', bold: true, fillColor: '#f3f4f6' },
          { text: formatDatePL(estimate.validTo) }
        ]
      ]
    },
    layout: {
      hLineWidth: () => 0.6,
      vLineWidth: () => 0.6,
      hLineColor: () => '#9ca3af',
      vLineColor: () => '#9ca3af',
      paddingLeft: () => 6,
      paddingRight: () => 6,
      paddingTop: () => 3,
      paddingBottom: () => 3
    }
  });

  const offerTitle = estimate.title ? `OFERTA: ${estimate.title}` : 'OFERTA / KOSZTORYS';

  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [34, 34, 34, 34],
    defaultStyle: {
      font: 'Roboto',
      fontSize: 9.5,
      color: '#111827',
      lineHeight: 1.25
    },
    content: [
      // NAGŁÓWEK DOKUMENTU
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: 'Jacek Zamecki', fontSize: 18, bold: true, margin: [0, 0, 0, 2] },
              {
                text: 'Kompozycja, Aranżacja, Produkcja muzyczna, Edukacja muzyczna',
                fontSize: 9.5,
                color: '#374151',
                margin: [0, 0, 0, 14]
              },
              {
                text: offerTitle,
                fontSize: 13,
                bold: true,
                margin: [0, 4, 0, 0]
              }
            ]
          },
          {
            width: 220,
            stack: rightHeaderStack
          }
        ],
        columnGap: 16,
        margin: [0, 0, 0, 14]
      },

      // GŁÓWNA TABELA POZYCJI
      {
        table: {
          headerRows: 1,
          dontBreakRows: true,
          widths: [24, '*', 46, 34, 64, 52, 72],
          body: tableBody
        },
        layout: {
          hLineWidth: () => 0.6,
          vLineWidth: () => 0.6,
          hLineColor: () => '#9ca3af',
          vLineColor: () => '#9ca3af',
          paddingLeft: () => 5,
          paddingRight: () => 5,
          paddingTop: () => 4,
          paddingBottom: () => 4
        },
        margin: [0, 0, 0, 14]
      },

      // DOLNY BLOK: TERMIN + PODSUMOWANIE 2x2 + KLAUZULE + DANE FIRMY + PODPIS
      {
        unbreakable: true,
        stack: [
          {
            columns: [
              {
                width: '*',
                stack: [
                  { text: 'Przewidywany termin realizacji:', bold: true, fontSize: 9.5 },
                  { text: '(wypełnia zleceniodawca)', fontSize: 8, color: '#4b5563', margin: [0, 1, 0, 10] },
                  { text: '........................................................................', color: '#6b7280' }
                ]
              },
              {
                width: 235,
                table: {
                  widths: ['*', 105],
                  body: [
                    [
                      { text: 'SUMA BRUTTO', bold: true, fillColor: '#f3f4f6' },
                      { text: formatPLN(grossBeforeGlobal), bold: true, alignment: 'right' }
                    ],
                    [
                      {
                        text: globalDiscountLabel ? `RABAT (${globalDiscountLabel})` : 'RABAT',
                        bold: true,
                        fillColor: '#f3f4f6'
                      },
                      {
                        text: globalDiscountAmt > 0 ? `-${formatPLN(globalDiscountAmt)}` : '—',
                        alignment: 'right'
                      }
                    ],
                    [
                      { text: 'SUMA KOŃCOWA', bold: true, fontSize: 10.5, fillColor: '#e5e7eb' },
                      { text: formatPLN(finalTotal), bold: true, fontSize: 12, alignment: 'right', fillColor: '#e5e7eb' }
                    ]
                  ]
                },
                layout: {
                  hLineWidth: () => 0.7,
                  vLineWidth: () => 0.7,
                  hLineColor: () => '#6b7280',
                  vLineColor: () => '#6b7280',
                  paddingLeft: () => 7,
                  paddingRight: () => 7,
                  paddingTop: () => 4,
                  paddingBottom: () => 4
                }
              }
            ],
            columnGap: 16,
            margin: [0, 0, 0, 14]
          },

          // Zastrzeżenie (nie jest ofertą handlową)
          {
            text: 'Powyższa wycena nie jest ofertą handlową. Koszt projektu może się różnić w zależności od zmiany parametrów projektu.',
            fontSize: 8.5,
            italics: true,
            color: '#374151',
            margin: [0, 0, 0, 12]
          },

          // Dane firmy + oświadczenie i podpis zleceniodawcy
          {
            columns: [
              {
                width: 195,
                stack: [
                  { text: 'Jacek Zamecki JZ Production', bold: true, fontSize: 9 },
                  { text: 'ul. Katowicka 48/1 52-022 Wrocław', fontSize: 8.5 },
                  { text: 'NIP: 8971667886', fontSize: 8.5 },
                  { text: 'REGON: 388058361', fontSize: 8.5 }
                ]
              },
              {
                width: '*',
                stack: [
                  {
                    text: 'Oświadczam, że zaznajomiłem/łam się z cennikiem oraz warunkami współpracy zamieszczonymi na stronie internetowej: www.jzproduction.pl. Przyjmuję warunki powyższej oferty oraz zlecam wykonanie prac.',
                    fontSize: 8.5,
                    color: '#1f2937',
                    margin: [0, 0, 0, 22]
                  },
                  {
                    text: '....................................................................',
                    alignment: 'right',
                    color: '#6b7280'
                  },
                  {
                    text: 'podpis',
                    alignment: 'right',
                    fontSize: 8,
                    color: '#4b5563',
                    margin: [0, 2, 46, 0]
                  }
                ]
              }
            ],
            columnGap: 18
          }
        ]
      }
    ],
    styles: {
      th: {
        bold: true,
        fontSize: 8.5,
        fillColor: '#e5e7eb',
        color: '#111827'
      }
    }
  };

  const titlePart = sanitizeFileName(estimate.title || 'Kosztorys');
  const clientPart = sanitizeFileName(estimate.client || '');
  const fileName = clientPart ? `Kosztorys_${titlePart}_${clientPart}.pdf` : `Kosztorys_${titlePart}.pdf`;

  pdfMake.createPdf(docDefinition).download(fileName);
}
