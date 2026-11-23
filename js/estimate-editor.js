export function formatPLN(amount) {
  const num = Number.isFinite(amount) ? amount : 0;
  return `${num.toLocaleString('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} zł`;
}

/**
 * Parsuje rabat:
 * - "15%" -> procentowy (15%)
 * - "-300" lub "300" -> kwotowy (300 zł)
 */
export function parseDiscount(rawInput, baseAmount) {
  const clean = String(rawInput ?? '').trim().replace(',', '.');
  if (!clean || baseAmount <= 0) {
    return { discountAmount: 0, label: '' };
  }

  if (clean.endsWith('%')) {
    const pct = Math.abs(parseFloat(clean.slice(0, -1)) || 0);
    const cappedPct = Math.min(pct, 100);
    const amt = (baseAmount * cappedPct) / 100;
    return {
      discountAmount: amt,
      label: cappedPct > 0 ? `${cappedPct}%` : ''
    };
  }

  const normalized = clean.startsWith('-') ? clean.slice(1) : clean;
  const fixed = Math.max(0, parseFloat(normalized) || 0);
  const cappedFixed = Math.min(fixed, baseAmount);
  return {
    discountAmount: cappedFixed,
    label: cappedFixed > 0 ? `-${formatPLN(cappedFixed)}` : ''
  };
}

function toNaturalInt(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.floor(num);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function createEmptyEstimate() {
  return {
    id: `est-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    status: 'draft', // 'draft' (szkic roboczy) | 'final' (domknięty po Generuj PDF)
    archived: false,
    title: '',
    client: '',
    validFrom: todayISO(),
    validTo: plusDaysISO(14),
    globalDiscount: '',
    items: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function initEstimateEditorModule({
  getState,
  onSaveDraft,
  onGeneratePdf
}) {
  const headingEl = document.getElementById('editor-heading');
  const badgeEl = document.getElementById('editor-mode-badge');
  const subtitleEl = document.getElementById('editor-subtitle');

  const titleInput = document.getElementById('est-title');
  const clientInput = document.getElementById('est-client');
  const validFromInput = document.getElementById('est-valid-from');
  const validToInput = document.getElementById('est-valid-to');
  const globalDiscountInput = document.getElementById('est-global-discount');

  const priceSelect = document.getElementById('est-pricelist-select');
  const addFromPriceBtn = document.getElementById('btn-add-from-pricelist');
  const addCustomBtn = document.getElementById('btn-add-custom-item');
  const addSubtotalBtn = document.getElementById('btn-add-subtotal');
  const addSeparatorBtn = document.getElementById('btn-add-separator');

  const tbody = document.getElementById('estimate-tbody');
  const sumGrossEl = document.getElementById('sum-gross');
  const sumDiscountEl = document.getElementById('sum-discount');
  const sumTotalEl = document.getElementById('sum-total');

  const newBtn = document.getElementById('btn-new-estimate');
  const saveDraftBtn = document.getElementById('btn-save-draft');
  const genPdfBtn = document.getElementById('btn-generate-pdf');

  let currentEstimate = createEmptyEstimate();
  let draggedItemIndex = null;

  function applySelectColorPreview() {
    const selectedOption = priceSelect.options[priceSelect.selectedIndex];
    const bg = selectedOption?.dataset?.color || '#ffffff';
    priceSelect.style.backgroundColor = bg;
  }

  function refreshPriceListDropdown() {
    const state = getState();
    const list = state.priceList || [];
    const previousValue = priceSelect.value;

    priceSelect.innerHTML = '<option value="" data-color="#ffffff">-- Wybierz usługę z cennika --</option>';
    list.forEach((srv, idx) => {
      const opt = document.createElement('option');
      const rowColor = srv.color || '#ffffff';
      opt.value = srv.id;
      opt.dataset.color = rowColor;
      opt.style.backgroundColor = rowColor;
      opt.style.color = '#1e242b';
      opt.textContent = `${idx + 1}. ${srv.name || 'Bez nazwy'} (${formatPLN(srv.price)} / ${srv.unit || 'usł.'})`;
      priceSelect.appendChild(opt);
    });

    if (previousValue && list.some(s => s.id === previousValue)) {
      priceSelect.value = previousValue;
    }
    applySelectColorPreview();
  }

  priceSelect.addEventListener('change', applySelectColorPreview);

  function updateHeaderBadge() {
    if (currentEstimate.status === 'final') {
      headingEl.textContent = currentEstimate.title
        ? `Kosztorys: ${currentEstimate.title}`
        : 'Edycja kosztorysu (utworzy nową wersję)';
      badgeEl.textContent = 'NOWA WERSJA Z PDF';
      badgeEl.className = 'status-pill status-final';
      subtitleEl.innerHTML =
        'Edytujesz kosztorys zamknięty PDF-em — kliknięcie <strong>Zapisz</strong> utworzy osobny szkic roboczy, a <strong>Generuj PDF</strong> domknie nową wersję (nie nadpisuje poprzedniego PDF-a).';
    } else {
      headingEl.textContent = currentEstimate.title
        ? `Szkic kosztorysu: ${currentEstimate.title}`
        : 'Nowy kosztorys';
      badgeEl.textContent = 'SZKIC ROBOCZY';
      badgeEl.className = 'status-pill status-draft';
      subtitleEl.innerHTML =
        'Pracujesz na szkicu roboczym — kliknięcie <strong>Zapisz</strong> aktualizuje ten szkic bez mnożenia wpisów, a <strong>Generuj PDF</strong> domyka kosztorys.';
    }
  }

  function syncMetaFromInputs() {
    currentEstimate.title = titleInput.value.trim();
    currentEstimate.client = clientInput.value.trim();
    currentEstimate.validFrom = validFromInput.value;
    currentEstimate.validTo = validToInput.value;
    currentEstimate.globalDiscount = globalDiscountInput.value;
  }

  function computeTotals() {
    let grossBeforeGlobal = 0;
    let runningSubtotal = 0;
    const computedRowTotals = new Map();

    currentEstimate.items.forEach((item, idx) => {
      if (item.type === 'service' || item.type === 'custom') {
        const qty = toNaturalInt(item.qty);
        const unitPrice = Number(item.price) || 0;
        const lineGross = qty * unitPrice;
        const { discountAmount } = parseDiscount(item.discount, lineGross);
        const lineNet = Math.max(0, lineGross - discountAmount);

        grossBeforeGlobal += lineNet;
        runningSubtotal += lineNet;
        computedRowTotals.set(idx, lineNet);
      } else if (item.type === 'subtotal') {
        computedRowTotals.set(idx, runningSubtotal);
        runningSubtotal = 0;
      } else if (item.type === 'separator') {
        runningSubtotal = 0;
      }
    });

    const { discountAmount: globalDiscountAmt } = parseDiscount(
      currentEstimate.globalDiscount,
      grossBeforeGlobal
    );
    const finalTotal = Math.max(0, grossBeforeGlobal - globalDiscountAmt);

    sumGrossEl.textContent = formatPLN(grossBeforeGlobal);
    sumDiscountEl.textContent = globalDiscountAmt > 0 ? `-${formatPLN(globalDiscountAmt)}` : formatPLN(0);
    sumTotalEl.textContent = formatPLN(finalTotal);

    return {
      gross: grossBeforeGlobal,
      discount: globalDiscountAmt,
      total: finalTotal,
      computedRowTotals
    };
  }

  function render() {
    refreshPriceListDropdown();
    updateHeaderBadge();

    titleInput.value = currentEstimate.title || '';
    clientInput.value = currentEstimate.client || '';
    validFromInput.value = currentEstimate.validFrom || todayISO();
    validToInput.value = currentEstimate.validTo || plusDaysISO(14);
    globalDiscountInput.value = currentEstimate.globalDiscount || '';

    const { computedRowTotals } = computeTotals();
    tbody.innerHTML = '';

    if (!currentEstimate.items.length) {
      const emptyTr = document.createElement('tr');
      emptyTr.innerHTML = `
        <td colspan="9" class="empty-table-msg">
          Brak pozycji w kosztorysie. Wybierz usługę z cennika lub dodaj pozycję „Inne”, sumę częściową albo separator.
        </td>
      `;
      tbody.appendChild(emptyTr);
      return;
    }

    let itemCounter = 0;

    currentEstimate.items.forEach((item, idx) => {
      // 1. WIERSZ SEPARATORA
      if (item.type === 'separator') {
        const tr = document.createElement('tr');
        tr.className = 'row-separator';
        tr.draggable = true;
        tr.dataset.idx = String(idx);

        tr.innerHTML = `
          <td class="drag-handle" title="Przeciągnij">⋮⋮</td>
          <td colspan="7">
            <div class="separator-inner">
              <span class="tag-pill">SEPARATOR</span>
              <input
                type="text"
                class="input js-sep-label"
                value="${escapeAttr(item.label || '')}"
                placeholder="Opcjonalny tytuł sekcji / przerwy (np. Część II)..."
              />
            </div>
          </td>
          <td style="text-align:right;">
            <button type="button" class="row-del-btn js-del-item" title="Usuń separator">×</button>
          </td>
        `;

        tr.querySelector('.js-sep-label').addEventListener('input', (e) => {
          item.label = e.target.value;
        });
        bindDelete(tr, idx);
        bindDrag(tr, idx);
        tbody.appendChild(tr);
        return;
      }

      // 2. WIERSZ SUMY CZĘŚCIOWEJ
      if (item.type === 'subtotal') {
        const subVal = computedRowTotals.get(idx) ?? 0;
        const tr = document.createElement('tr');
        tr.className = 'row-subtotal';
        tr.draggable = true;
        tr.dataset.idx = String(idx);

        tr.innerHTML = `
          <td class="drag-handle" title="Przeciągnij">⋮⋮</td>
          <td></td>
          <td colspan="5">
            <div class="subtotal-inner">
              <span class="tag-pill">SUMA CZĘŚCIOWA</span>
              <input
                type="text"
                class="input js-sub-label"
                value="${escapeAttr(item.label || 'Suma częściowa')}"
                placeholder="Nazwa sumy częściowej..."
              />
            </div>
          </td>
          <td class="subtotal-amount">${formatPLN(subVal)}</td>
          <td style="text-align:right;">
            <button type="button" class="row-del-btn js-del-item" title="Usuń sumę częściową">×</button>
          </td>
        `;

        tr.querySelector('.js-sub-label').addEventListener('input', (e) => {
          item.label = e.target.value;
        });
        bindDelete(tr, idx);
        bindDrag(tr, idx);
        tbody.appendChild(tr);
        return;
      }

      // 3. WIERSZ USŁUGI LUB "INNE" (+ wcięty wiersz notatek poniżej)
      itemCounter += 1;
      const lineTotal = computedRowTotals.get(idx) ?? 0;
      const isCustom = item.type === 'custom';
      const naturalQty = toNaturalInt(item.qty);
      item.qty = naturalQty;

      const tr = document.createElement('tr');
      tr.className = 'row-item';
      tr.draggable = true;
      tr.dataset.idx = String(idx);
      if (item.color) {
        tr.style.backgroundColor = item.color;
      }

      tr.innerHTML = `
        <td class="drag-handle" rowspan="2" title="Przeciągnij pozycję wraz z notatką">⋮⋮</td>
        <td rowspan="2" class="item-lp">${itemCounter}.</td>
        <td>
          <div class="service-cell">
            ${isCustom ? '<span class="tag-pill tag-custom">INNE</span>' : ''}
            <input
              type="text"
              class="input js-name"
              value="${escapeAttr(item.name)}"
              placeholder="${isCustom ? 'Wpisz nazwę pozycji niestandardowej...' : 'Nazwa usługi...'}"
            />
          </div>
        </td>
        <td>
          <input type="text" class="input js-unit" value="${escapeAttr(item.unit)}" placeholder="jedn." />
        </td>
        <td>
          <input
            type="number"
            step="1"
            min="0"
            inputmode="numeric"
            class="input num-input js-qty"
            value="${naturalQty}"
          />
        </td>
        <td>
          <input type="number" step="0.01" min="0" class="input num-input js-price" value="${Number(item.price) || 0}" />
        </td>
        <td>
          <input
            type="text"
            class="input js-discount"
            value="${escapeAttr(item.discount || '')}"
            placeholder="np. 10% lub -200"
          />
        </td>
        <td class="line-total js-line-total">${formatPLN(lineTotal)}</td>
        <td rowspan="2" style="text-align:right; vertical-align:middle;">
          <button type="button" class="row-del-btn js-del-item" title="Usuń pozycję wraz z notatkami">×</button>
        </td>
      `;

      // Wcięty wiersz notatek pod pozycją
      const noteTr = document.createElement('tr');
      noteTr.className = 'row-note';
      if (item.color) {
        noteTr.style.backgroundColor = item.color;
      }
      noteTr.innerHTML = `
        <td colspan="6">
          <div class="note-indent">
            <span class="note-prefix">↳ Notatki:</span>
            <input
              type="text"
              class="input note-input js-note"
              value="${escapeAttr(item.note || '')}"
              placeholder="Szczegóły wykonania, instrumentarium, uwagi do pozycji..."
            />
          </div>
        </td>
      `;

      const recalcSingleRow = () => {
        const totals = computeTotals();
        const updatedLine = totals.computedRowTotals.get(idx) ?? 0;
        const lineEl = tr.querySelector('.js-line-total');
        if (lineEl) lineEl.textContent = formatPLN(updatedLine);

        tbody.querySelectorAll('tr.row-subtotal').forEach((subTr) => {
          const subIdx = Number(subTr.dataset.idx);
          const amtCell = subTr.querySelector('.subtotal-amount');
          if (amtCell) {
            amtCell.textContent = formatPLN(totals.computedRowTotals.get(subIdx) ?? 0);
          }
        });
      };

      tr.querySelector('.js-name').addEventListener('input', (e) => {
        item.name = e.target.value;
      });
      tr.querySelector('.js-unit').addEventListener('input', (e) => {
        item.unit = e.target.value;
      });

      const qtyInput = tr.querySelector('.js-qty');
      qtyInput.addEventListener('input', (e) => {
        item.qty = toNaturalInt(e.target.value);
        recalcSingleRow();
      });
      qtyInput.addEventListener('change', (e) => {
        const cleaned = toNaturalInt(e.target.value);
        e.target.value = String(cleaned);
        item.qty = cleaned;
        recalcSingleRow();
      });

      tr.querySelector('.js-price').addEventListener('input', (e) => {
        item.price = parseFloat(e.target.value) || 0;
        recalcSingleRow();
      });
      tr.querySelector('.js-discount').addEventListener('input', (e) => {
        item.discount = e.target.value;
        recalcSingleRow();
      });
      noteTr.querySelector('.js-note').addEventListener('input', (e) => {
        item.note = e.target.value;
      });

      bindDelete(tr, idx);
      bindDrag(tr, idx);

      tbody.appendChild(tr);
      tbody.appendChild(noteTr);
    });
  }

  function bindDelete(tr, idx) {
    tr.querySelector('.js-del-item').addEventListener('click', () => {
      currentEstimate.items.splice(idx, 1);
      render();
    });
  }

  function bindDrag(tr, idx) {
    tr.addEventListener('dragstart', (e) => {
      draggedItemIndex = idx;
      tr.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    tr.addEventListener('dragend', () => {
      draggedItemIndex = null;
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('dragging', 'drag-over'));
    });

    tr.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (draggedItemIndex === null || draggedItemIndex === idx) return;
      tr.classList.add('drag-over');
    });

    tr.addEventListener('dragleave', () => {
      tr.classList.remove('drag-over');
    });

    tr.addEventListener('drop', (e) => {
      e.preventDefault();
      tr.classList.remove('drag-over');
      if (draggedItemIndex === null || draggedItemIndex === idx) return;

      const [moved] = currentEstimate.items.splice(draggedItemIndex, 1);
      currentEstimate.items.splice(idx, 0, moved);
      render();
    });
  }

  // Dodawanie pozycji
  addFromPriceBtn.addEventListener('click', () => {
    const selectedId = priceSelect.value;
    if (!selectedId) {
      alert('Wybierz najpierw pozycję z cennika.');
      return;
    }
    const state = getState();
    const srv = (state.priceList || []).find(s => s.id === selectedId);
    if (!srv) return;

    currentEstimate.items.push({
      id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      type: 'service',
      sourceServiceId: srv.id,
      name: srv.name,
      unit: srv.unit || 'usł.',
      qty: 1,
      price: Number(srv.price) || 0,
      color: srv.color || '#ffffff',
      discount: '',
      note: ''
    });
    render();
  });

  addCustomBtn.addEventListener('click', () => {
    currentEstimate.items.push({
      id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      type: 'custom',
      name: '',
      unit: 'usł.',
      qty: 1,
      price: 0,
      color: '#ffffff',
      discount: '',
      note: ''
    });
    render();
  });

  addSubtotalBtn.addEventListener('click', () => {
    currentEstimate.items.push({
      id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      type: 'subtotal',
      label: 'Suma częściowa'
    });
    render();
  });

  addSeparatorBtn.addEventListener('click', () => {
    currentEstimate.items.push({
      id: `sep-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      type: 'separator',
      label: ''
    });
    render();
  });

  // Pola nagłówka i rabat globalny
  [titleInput, clientInput, validFromInput, validToInput].forEach((el) => {
    el.addEventListener('input', () => {
      syncMetaFromInputs();
      if (el === titleInput) updateHeaderBadge();
    });
  });

  globalDiscountInput.addEventListener('input', () => {
    currentEstimate.globalDiscount = globalDiscountInput.value;
    computeTotals();
  });

  // Przyciski akcji
  newBtn.addEventListener('click', () => {
    currentEstimate = createEmptyEstimate();
    render();
  });

  saveDraftBtn.addEventListener('click', async () => {
    syncMetaFromInputs();
    const totals = computeTotals();
    currentEstimate.updatedAt = new Date().toISOString();

    const payload = {
      ...structuredClone(currentEstimate),
      id: currentEstimate.status === 'final'
        ? `est-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        : currentEstimate.id,
      status: 'draft',
      archived: false,
      summary: {
        gross: totals.gross,
        discount: totals.discount,
        total: totals.total
      }
    };

    currentEstimate = payload;
    updateHeaderBadge();
    await onSaveDraft(structuredClone(payload));
  });

  genPdfBtn.addEventListener('click', async () => {
    syncMetaFromInputs();
    const totals = computeTotals();
    currentEstimate.updatedAt = new Date().toISOString();

    const finalized = {
      ...structuredClone(currentEstimate),
      id: currentEstimate.status === 'final'
        ? `est-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        : currentEstimate.id,
      status: 'final',
      archived: false,
      finalizedAt: new Date().toISOString(),
      summary: {
        gross: totals.gross,
        discount: totals.discount,
        total: totals.total
      }
    };

    currentEstimate = finalized;
    updateHeaderBadge();
    await onGeneratePdf(structuredClone(finalized));
  });

  function loadEstimate(estimateObj, mode = 'edit') {
    const clone = structuredClone(estimateObj);
    if (mode === 'template') {
      clone.id = `est-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      clone.status = 'draft';
      clone.archived = false;
      clone.client = '';
      clone.validFrom = todayISO();
      clone.validTo = plusDaysISO(14);
      clone.createdAt = new Date().toISOString();
    } else if (clone.status === 'final') {
      clone.status = 'draft';
      clone.archived = false;
      clone.createdAt = new Date().toISOString();
    }
    clone.updatedAt = new Date().toISOString();
    currentEstimate = clone;
    render();
  }

  render();

  return {
    render,
    loadEstimate
  };
}

function escapeAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
