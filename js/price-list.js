export const PASTEL_PALETTE = [
  { id: 'none', label: 'Brak', hex: '#ffffff' },
  { id: 'blue', label: 'Błękitny', hex: '#e8f1ff' },
  { id: 'green', label: 'Miętowy', hex: '#e6f7ed' },
  { id: 'yellow', label: 'Kremowy', hex: '#fef7dc' },
  { id: 'purple', label: 'Lawendowy', hex: '#f1eafe' },
  { id: 'peach', label: 'Brzoskwiniowy', hex: '#ffece4' }
];

// Przykładowe pozycje startowe zgodne z Twoimi dotychczasowymi kosztorysami (gdy baza jest pusta)
export const DEFAULT_PRICE_LIST = [
  { id: 'srv-1', name: 'MUZYKA ROZRYWKOWA - KOMPOZYCJA; pilot audio; do 5 instrumentów', unit: 'min.', price: 240, color: '#e8f1ff' },
  { id: 'srv-2', name: 'MUZYKA ROZRYWKOWA - ARANŻACJA; pilot audio; 6-19 instrumentów', unit: 'min.', price: 390, color: '#e8f1ff' },
  { id: 'srv-3', name: 'Zrealizowanie pojedynczej partii - brzmienia vsti - do 5 min', unit: 'usł.', price: 300, color: '#e6f7ed' },
  { id: 'srv-4', name: 'Wynajem sesyjnego muzyka', unit: 'usł.', price: 250, color: '#fef7dc' },
  { id: 'srv-5', name: 'Nagranie studyjne', unit: 'h.', price: 180, color: '#ffece4' },
  { id: 'srv-6', name: 'Edycja głęboka śladów - intonacja, timing', unit: 'h.', price: 200, color: '#ffece4' },
  { id: 'srv-7', name: 'Mix do 6 min utworu - Do 20 ścieżek', unit: 'usł.', price: 550, color: '#f1eafe' },
  { id: 'srv-8', name: 'Mix do 6 min utworu - 20-50 ścieżek', unit: 'usł.', price: 1000, color: '#f1eafe' },
  { id: 'srv-9', name: 'Mastering', unit: 'Utwór', price: 200, color: '#f1eafe' }
];

export function initPriceListModule({ getState, onPriceListChanged }) {
  const tbody = document.getElementById('pricelist-tbody');
  const searchInput = document.getElementById('pricelist-search');
  const countLabel = document.getElementById('pricelist-count');
  const addBtn = document.getElementById('btn-add-service');

  let draggedIndex = null;

  function render() {
    const state = getState();
    const list = state.priceList || [];
    const query = searchInput.value.trim().toLowerCase();

    const filtered = list
      .map((item, realIndex) => ({ item, realIndex }))
      .filter(({ item }) => {
        if (!query) return true;
        return (
          item.name.toLowerCase().includes(query) ||
          item.unit.toLowerCase().includes(query)
        );
      });

    countLabel.textContent = `${filtered.length} z ${list.length} pozycji`;
    tbody.innerHTML = '';

    filtered.forEach(({ item, realIndex }, visibleIdx) => {
      const tr = document.createElement('tr');
      tr.style.backgroundColor = item.color || '#ffffff';
      tr.dataset.realIndex = String(realIndex);

      // Drag & drop działa przy pełnej liście (bez aktywnego filtra wyszukiwania)
      const canDrag = !query;
      tr.draggable = canDrag;

      tr.innerHTML = `
        <td class="drag-handle" title="${canDrag ? 'Przeciągnij, aby zmienić kolejność' : 'Wyczyść wyszukiwanie, aby zmieniać kolejność'}">
          ${canDrag ? '⋮⋮' : '·'}
        </td>
        <td>${visibleIdx + 1}.</td>
        <td>
          <input type="text" class="input js-name" value="${escapeAttr(item.name)}" placeholder="Nazwa usługi..." />
        </td>
        <td>
          <input type="text" class="input js-unit" value="${escapeAttr(item.unit)}" placeholder="np. usł., min., h." />
        </td>
        <td>
          <input type="number" step="0.01" min="0" class="input num-input js-price" value="${Number(item.price) || 0}" />
        </td>
        <td>
          <div class="color-swatches">
            ${PASTEL_PALETTE.map(c => `
              <button
                type="button"
                class="swatch ${(item.color || '#ffffff').toLowerCase() === c.hex ? 'selected' : ''}"
                style="background:${c.hex}"
                title="${c.label}"
                data-color="${c.hex}"
              ></button>
            `).join('')}
          </div>
        </td>
        <td style="text-align:right;">
          <button type="button" class="del-btn js-delete" title="Usuń pozycję z cennika">✕</button>
        </td>
      `;

      // Edycja pól tekstowych i ceny
      tr.querySelector('.js-name').addEventListener('input', (e) => {
        item.name = e.target.value;
        onPriceListChanged();
      });

      tr.querySelector('.js-unit').addEventListener('input', (e) => {
        item.unit = e.target.value;
        onPriceListChanged();
      });

      tr.querySelector('.js-price').addEventListener('input', (e) => {
        item.price = parseFloat(e.target.value) || 0;
        onPriceListChanged();
      });

      // Zmiana koloru roboczego
      tr.querySelectorAll('.swatch').forEach((btn) => {
        btn.addEventListener('click', () => {
          item.color = btn.dataset.color;
          tr.style.backgroundColor = item.color;
          tr.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
          btn.classList.add('selected');
          onPriceListChanged();
        });
      });

      // Usuwanie pozycji
      tr.querySelector('.js-delete').addEventListener('click', () => {
        if (!confirm(`Usunąć pozycję „${item.name || 'Bez nazwy'}” z cennika?`)) return;
        state.priceList.splice(realIndex, 1);
        render();
        onPriceListChanged();
      });

      // Obsługa drag & drop kolejności
      if (canDrag) {
        tr.addEventListener('dragstart', (e) => {
          draggedIndex = realIndex;
          tr.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
        });

        tr.addEventListener('dragend', () => {
          draggedIndex = null;
          tbody.querySelectorAll('tr').forEach(r => r.classList.remove('dragging', 'drag-over'));
        });

        tr.addEventListener('dragover', (e) => {
          e.preventDefault();
          if (draggedIndex === null || draggedIndex === realIndex) return;
          tr.classList.add('drag-over');
        });

        tr.addEventListener('dragleave', () => {
          tr.classList.remove('drag-over');
        });

        tr.addEventListener('drop', (e) => {
          e.preventDefault();
          tr.classList.remove('drag-over');
          if (draggedIndex === null || draggedIndex === realIndex) return;

          const [moved] = state.priceList.splice(draggedIndex, 1);
          state.priceList.splice(realIndex, 0, moved);
          render();
          onPriceListChanged();
        });
      }

      tbody.appendChild(tr);
    });
  }

  addBtn.addEventListener('click', () => {
    const state = getState();
    state.priceList.push({
      id: `srv-${Date.now()}`,
      name: '',
      unit: 'usł.',
      price: 0,
      color: '#ffffff'
    });
    searchInput.value = '';
    render();
    onPriceListChanged();

    // Ustaw kursor w polu nazwy nowo dodanego wiersza
    const lastInput = tbody.querySelector('tr:last-child .js-name');
    if (lastInput) lastInput.focus();
  });

  searchInput.addEventListener('input', render);

  return { render };
}

function escapeAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
