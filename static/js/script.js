
/* ============================================================
   Laudo Web — script.js (refatorado com cautela)
   - Preços: prevenção de duplicidades, fallback online/offline para UFs/municípios.
   - Máscaras/validações centralizadas (CPF/CNPJ, telefone, letras/números/decimal, matrícula).
   - Boot único (DOMContentLoaded) e required apenas em inputs editáveis.
   - Cálculos e totalizadores (agrícola/pecuária), histórico, rebanho, bens.
   - Galeria com IndexedDB (compressão opcional para WebP).
   - Geração de PDF (html2pdf) com estilos ajustados.
   ============================================================ */


/* ============================================================
   UTILITÁRIOS (mantenha apenas UMA definição de cada)
   ============================================================ */

const brl = (v) => (isNaN(v) ? 0 : v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (!v) return 0;
  const s = String(v).trim();
  const normalized = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

const qsa = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const qs  = (sel, el = document) => el.querySelector(sel);

function debounce(fn, wait = 150) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* Apenas UMA versão de maskInteger() no arquivo */
function maskInteger(inputEl) {
  if (!inputEl) return;

  inputEl.addEventListener('input', function () {
    const before = this.value;
    const after  = before.replace(/\D/g, '');
    if (before !== after) this.value = after;
  });

  inputEl.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text') || '';
    inputEl.value = pasted.replace(/\D/g, '');
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  });

  inputEl.addEventListener('blur', function () {
    this.value = (this.value || '').replace(/\D/g, '');
  });
}

/* ============================================================
   PREÇOS DO PRODUTO
   ============================================================ */
const statePrecos = new Map(); // Map<CULTURA, PREÇO>
let precosInicializados = false;

function initPrecos() {
  if (precosInicializados) return;
  precosInicializados = true;

  const precosPlanilha = [
    ['CAFÉ ARÁBICA', '2025-08-06', 'CONAB', 'AREADO', 'MG', 1755],
    ['MILHO', '2025-08-06', 'CONAB', 'AREADO', 'MG', 63],
    ['BOVINOCULTURA DE CORTE', '2025-08-06', 'CONAB', 'AREADO', 'MG', 282.94],
  ];

  const tbody = qs('#tbl-precos tbody');
  precosPlanilha.forEach(p => addRowPrecoFromSheet(tbody, ...p));
}


/* Fallback: carrega UFs (IBGE → JSON local) */
async function carregarUFsComFallback(selectUF) {
  try {
    const res = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados', { cache: 'no-store' });
    const estados = await res.json();
    estados.sort((a, b) => a.sigla.localeCompare(b.sigla, 'pt-BR'));
    selectUF.innerHTML = `<option value="" disabled selected>Selecione o estado</option>`;
    estados.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.sigla;
      opt.textContent = e.sigla;
      selectUF.appendChild(opt);
    });
  } catch {
    try {
      const resLocal = await fetch('static/json/estados-cidades.json', { cache: 'no-cache' });
      const dataset = await resLocal.json();
      const estados = Array.isArray(dataset?.estados) ? dataset.estados : [];
      estados.sort((a, b) => a.sigla.localeCompare(b.sigla, 'pt-BR'));
      selectUF.innerHTML = `<option value="" disabled selected>Selecione o estado</option>`;
      estados.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.sigla;
        opt.textContent = e.sigla;
        selectUF.appendChild(opt);
      });
    } catch {
      selectUF.innerHTML = `<option value="" disabled selected>Erro ao carregar estados</option>`;
    }
  }
}

/* Fallback: carrega municípios por UF (IBGE/BrasilAPI → JSON local) */
async function carregarMunicipiosComFallback(ufSigla, selectMun) {
  // tenta IBGE por ID via lista geral; se falhar, tenta BrasilAPI; se falhar, JSON local
  selectMun.innerHTML = `<option value="" disabled selected>Carregando...</option>`;
  try {
    // BrasilAPI por sigla é simples
    const res = await fetch(`https://brasilapi.com.br/api/ibge/municipios/v1/${ufSigla}`, { cache: 'no-store' });
    let municipios = await res.json();
    municipios = (Array.isArray(municipios) ? municipios : []).map(m => m.nome);
    municipios.sort((a, b) => a.localeCompare(b, 'pt-BR'));
    selectMun.innerHTML = `<option value="" disabled selected>Selecione o município</option>`;
    municipios.forEach(nome => {
      const opt = document.createElement('option');
      opt.value = nome;
      opt.textContent = nome;
      selectMun.appendChild(opt);
    });
  } catch {
    try {
      const resLocal = await fetch('static/json/estados-cidades.json', { cache: 'no-cache' });
      const dataset = await resLocal.json();
      const estado = (dataset?.estados || []).find(e => e.sigla === ufSigla);
      const cidades = Array.isArray(estado?.cidades) ? estado.cidades.slice() : [];
      cidades.sort((a, b) => a.localeCompare(b, 'pt-BR'));
      selectMun.innerHTML = `<option value="" disabled selected>Selecione o município</option>`;
      cidades.forEach(nome => {
        const opt = document.createElement('option');
        opt.value = nome;
        opt.textContent = nome;
        selectMun.appendChild(opt);
      });
    } catch {
      selectMun.innerHTML = `<option value="" disabled selected>Erro ao carregar</option>`;
    }
  }
}



/*LINHA DA PLANILHA PREÇO PRODUTO*/


/* Linha a partir da planilha */
function addRowPrecoFromSheet(
  tbody,
  cultura = '',
  data = '',
  fonte = '',
  mun = '',
  uf = '',
  preco = 0
) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>
      <input type="text" class="preco-cultura uppercase force-uppercase"
             value="${cultura}" placeholder="Digite a cultura / atividade" required />
    </td>

    <td><input type="date" value="${data}" class="preco-data" required /></td>
    <td><input type="text" value="${fonte}" class="preco-fonte" placeholder="Fonte" /></td>

    <td>
      <select class="preco-uf" required>
        <option value="" disabled selected>Carregando estados...</option>
      </select>
    </td>

    <td>
      <select class="preco-mun" required disabled>
        <option value="" disabled selected>Selecione o município</option>
      </select>
    </td>

    <td>
      <input type="text" class="preco-valor" 
             value="${preco ? preco.toString().replace('.', ',') : ''}"
             placeholder="0,00"/>
    </td>

    <td><button type="button" class="btn btn-remove">Remover</button></td>
  `;
  tbody.appendChild(tr);

  // --------- Máscara BRL aplicada na linha carregada ---------
  const precoInput = tr.querySelector('.preco-valor');
  maskBRL(precoInput);

  // --------- Manter valor formatado ao carregar ---------
  if (preco) {
    precoInput.value = preco
      .toFixed(2)
      .replace('.', ',')
      .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  // --------- Cultura ---------
  const selCultura = tr.querySelector('.preco-cultura');
  if (cultura) selCultura.value = cultura;

  // --------- UF + Município ---------
  const selUF = tr.querySelector('.preco-uf');
  const selMun = tr.querySelector('.preco-mun');

  carregarUFsComFallback(selUF).then(() => {
    if (uf) selUF.value = uf;

    if (uf) {
      carregarMunicipiosComFallback(uf, selMun).then(() => {
        selMun.disabled = false;
        if (mun) selMun.value = mun;
      });
    }
  });

  selUF.addEventListener('change', async () => {
    selMun.disabled = true;
    await carregarMunicipiosComFallback(selUF.value, selMun);
    selMun.disabled = false;
  });

  // --------- Remove syncPrecoRow para este input específico ---------
  wirePrecoRowEvents(tr);

  
// ✅ registra imediatamente o preço carregado (sem precisar digitar)
syncPrecoRow(tr);

}




/* Linha vazia */
function addRowPrecoEmpty() {
  const tbody = qs('#tbl-precos tbody');
  const tr = document.createElement('tr');

  tr.innerHTML = `
  <td>
  <input type="text" class="preco-cultura uppercase force-uppercase"
         placeholder="Digite a cultura / atividade" required />
  </td>

    <td><input type="date" class="preco-data" required /></td>
    <td><input type="text" class="preco-fonte" placeholder="Fonte" /></td>
    <td>
      <select class="preco-uf" required>
        <option value="" disabled selected>Carregando estados...</option>
      </select>
    </td>
    <td>
      <select class="preco-mun" required disabled>
        <option value="" disabled selected>Selecione o município</option>
      </select>
    </td>
    <td><input type="text" class="preco-valor" placeholder="0,00"/></td>
    <td><button type="button" class="btn btn-remove">Remover</button></td>
  `;
  tbody.appendChild(tr);

  
// 🔥 APLICA A MÁSCARA AO CAMPO DE PREÇO
  maskBRL(tr.querySelector('.preco-valor'));

  wirePrecoRowEvents(tr);

  const selUF = tr.querySelector('.preco-uf');
  const selMun = tr.querySelector('.preco-mun');

  carregarUFsComFallback(selUF);

  selUF.addEventListener('change', async () => {
    selMun.disabled = true;
    await carregarMunicipiosComFallback(selUF.value, selMun);
    selMun.disabled = false;
  });
}



function wirePrecoRowEvents(tr) {
  tr.querySelector('.btn-remove').addEventListener('click', () => {
    const key = tr.querySelector('.preco-cultura').value.trim().toUpperCase();
    statePrecos.delete(key);
    tr.remove();
    recalcAll();
  });

  const debouncedSync = debounce(() => syncPrecoRow(tr), 120);

  // Agora inclui TAMBÉM o campo .preco-valor
  tr.querySelectorAll('input, select').forEach(inp =>
    inp.addEventListener('input', debouncedSync)
  );
}


function syncPrecoRow(tr) {
  const cultura = tr.querySelector('.preco-cultura').value.trim().toUpperCase();
  // pega o valor e converte para número sem apagar máscara 
  const valorStr = tr.querySelector('.preco-valor').value;
  const valor = Number(valorStr.replace(/\./g, '').replace(',', '.')) || 0;


  if (!cultura) return;

  // Prevenir duplicidade de cultura
  const rows = qsa('#tbl-precos tbody tr');
  const repetidas = rows.filter(r => r !== tr && r.querySelector('.preco-cultura').value.trim().toUpperCase() === cultura);
  if (repetidas.length) {
    alert(`Já existe um preço para ${cultura}. Remova a linha duplicada ou altere a cultura.`);
    return;
  }

  statePrecos.set(cultura, valor || 0);
  recalcAll();
}

/* ============================================================
   FORM: Máscaras e validações (centralizadas)
   ============================================================ */

// Letras + números + acentos + espaço + hífen + apóstrofo
const allowedLettersNumbersRegex = /[^0-9A-Za-zÀ-ÖØ-öø-ÿ\s'-]/g;
// Apenas letras + acentos + espaço + hífen + apóstrofo
const allowedLettersOnlyRegex = /[^A-Za-zÀ-ÖØ-öø-ÿ\s'-]/g;

function attachLettersNumbers(inputEl, labelText) {
  inputEl.addEventListener('input', () => {
    const before = inputEl.value;
    const after = (before || '').replace(allowedLettersNumbersRegex, '');
    if (before !== after) inputEl.value = after;

    if (!after.trim().length) {
      inputEl.setCustomValidity('');
    } else if (!/^[0-9A-Za-zÀ-ÖØ-öø-ÿ\s'-]+$/.test(after)) {
      inputEl.setCustomValidity(`${labelText} deve conter apenas letras, números, espaços, hífen ou apóstrofo.`);
    } else {
      inputEl.setCustomValidity('');
    }
  });

  inputEl.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    inputEl.value = (pasted || '').replace(allowedLettersNumbersRegex, '');
    inputEl.dispatchEvent(new Event('input'));
  });

  inputEl.addEventListener('blur', () => {
    inputEl.value = (inputEl.value || '').replace(allowedLettersNumbersRegex, '');
  });
}

function attachLettersOnly(inputEl, labelText) {
  inputEl.addEventListener('input', () => {
    const before = inputEl.value;
    const after = (before || '').replace(allowedLettersOnlyRegex, '');
    if (before !== after) inputEl.value = after;

    if (!after.trim().length) {
      inputEl.setCustomValidity('');
    } else if (!/^[A-Za-zÀ-ÖØ-öø-ÿ\s'-]+$/.test(after)) {
      inputEl.setCustomValidity(`${labelText} deve conter apenas letras, espaços, hífen ou apóstrofo.`);
    } else {
      inputEl.setCustomValidity('');
    }
  });

  inputEl.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    inputEl.value = (pasted || '').replace(allowedLettersOnlyRegex, '');
    inputEl.dispatchEvent(new Event('input'));
  });

  inputEl.addEventListener('blur', () => {
    inputEl.value = (inputEl.value || '').replace(allowedLettersOnlyRegex, '');
  });
}

function attachDecimal(inputEl) {
  inputEl.addEventListener('input', () => {
    let s = (inputEl.value || '').replace(/[^\d.,]/g, '');
    const parts = s.replace(',', '.').split('.');
    if (parts.length > 2) {
      s = parts[0] + '.' + parts.slice(1).join(''); // apenas um separador decimal
    } else {
      s = s.replace(',', '.');
    }
    inputEl.value = s;

    if (!/^\d+(?:[.,]\d+)?$/.test(s) && s.trim().length) {
      inputEl.setCustomValidity('Use apenas números e separador decimal vírgula (,) ou ponto (.). Ex.: 123,45');
    } else {
      inputEl.setCustomValidity('');
    }
  });

  inputEl.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    inputEl.value = (pasted || '').replace(/[^\d.,]/g, '');
    inputEl.dispatchEvent(new Event('input'));
  });

  inputEl.addEventListener('blur', () => {
    inputEl.value = (inputEl.value || '').replace(/[^\d.,]/g, '');
  });
}

function attachCPF(inputEl, helpEl) {
  const onlyDigits = (s) => (s || '').replace(/\D/g, '');

  function formatCPF(s) {
    const d = onlyDigits(s).slice(0, 11);
    const p1 = d.slice(0, 3);
    const p2 = d.slice(3, 6);
    const p3 = d.slice(6, 9);
    const p4 = d.slice(9, 11);
    let out = '';
    if (p1) out += p1;
    if (p2) out += (out ? '.' : '') + p2;
    if (p3) out += (out ? '.' : '') + p3;
    if (p4) out += (out ? '-' : '') + p4;
    return out;
  }

  const updateValidity = () => {
    const d = onlyDigits(inputEl.value);
    if (!d.length) {
      helpEl && (helpEl.textContent = '');
      inputEl.setCustomValidity('');
      return;
    }
    if (d.length !== 11) {
      helpEl && (helpEl.textContent = 'CPF incompleto. Use 000.000.000-00.');
      inputEl.setCustomValidity('CPF incompleto. Use 000.000.000-00.');
    } else {
      helpEl && (helpEl.textContent = '');
      inputEl.setCustomValidity('');
    }
  };

  inputEl.addEventListener('input', () => {
    inputEl.value = formatCPF(inputEl.value);
    updateValidity();
  });

  inputEl.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    inputEl.value = formatCPF(pasted);
    updateValidity();
  });

  inputEl.addEventListener('blur', () => {
    inputEl.value = formatCPF(inputEl.value);
    updateValidity();
  });

  inputEl.value = formatCPF(inputEl.value);
  updateValidity();
}

function attachMatricula13(inputEl, helpEl) {
  const onlyDigits = (s) => (s || '').replace(/\D/g, '');

  inputEl.addEventListener('input', () => {
    const digits = onlyDigits(inputEl.value).slice(0, 13);
    inputEl.value = digits;

    if (!digits.length) {
      helpEl && (helpEl.textContent = '');
      inputEl.setCustomValidity('');
      return;
    }
    if (digits.length !== 13) {
      helpEl && (helpEl.textContent = 'A matrícula deve conter exatamente 13 dígitos.');
      inputEl.setCustomValidity('A matrícula deve conter exatamente 13 dígitos.');
    } else {
      helpEl && (helpEl.textContent = '');
      inputEl.setCustomValidity('');
    }
  });

  inputEl.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    inputEl.value = onlyDigits(pasted).slice(0, 13);
    inputEl.dispatchEvent(new Event('input'));
  });

  inputEl.addEventListener('blur', () => {
    inputEl.value = onlyDigits(inputEl.value).slice(0, 13);
  });

  inputEl.value = onlyDigits(inputEl.value).slice(0, 13);
  inputEl.dispatchEvent(new Event('input'));
}

function initTelefoneMask(telInput) {
  function onlyDigits(str) { return (str || '').replace(/\D/g, ''); }
  function formatPhone(digits) {
    digits = onlyDigits(digits).slice(0, 11);
    const ddd = digits.slice(0, 2);
    const nove = digits.slice(2, 3);
    const p1 = digits.slice(3, 7);
    const p2 = digits.slice(7, 11);
    let out = '';
    if (ddd.length) out += `(${ddd}`;
    if (ddd.length === 2) out += `)`;
    if (digits.length > 2) out += ` ${nove || ''}`;
    if (digits.length > 3) out += ` ${p1}`;
    if (digits.length > 7) out += `-${p2}`;
    return out;
  }
  function updateValidity() {
    const rawDigits = onlyDigits(telInput.value);
    if (!rawDigits.length) {
      telInput.setCustomValidity('');
      return;
    }
    if (rawDigits.length < 11) {
      telInput.setCustomValidity('Telefone incompleto. Use (XX) 9 9999-9999.');
    } else if (rawDigits[2] !== '9') {
      telInput.setCustomValidity('Falta o dígito 9 após o DDD.');
    } else {
      telInput.setCustomValidity('');
    }
  }

  telInput.addEventListener('input', () => {
    telInput.value = formatPhone(telInput.value);
    updateValidity();
  });
  telInput.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    telInput.value = formatPhone(pasted);
    updateValidity();
  });
  telInput.addEventListener('blur', () => {
    telInput.value = formatPhone(telInput.value);
    updateValidity();
  });

  telInput.value = formatPhone(telInput.value);
  updateValidity();
}

function initFormMasks() {
  // Cliente
  attachLettersOnly(qs('#cliente-nome'), 'Nome do cliente');
  attachLettersOnly(qs('#cliente-resp-tec'), 'Responsável técnico');

  // Telefone
  initTelefoneMask(qs('#cliente-telefone'));

  // Valor Terra Nua (base)
const terraNuaBase = qs('#prop-terra-nua');
if (terraNuaBase) maskBRL(terraNuaBase);


/* ============================================================
   ESSA ESTRUTURA UM MESMO CAMPO PODE ACEITAR CPF e CNPJ AO MESMO TEMPO E FORMATAR ELES A MEDIDA QUE O USUÁRIO DIGITA
   ============================================================ */
  
  // CPF/CNPJ — máscara dinâmica
  const inputCpfCnpj = qs('#cliente-cpfcnpj');
  if (inputCpfCnpj) {
    inputCpfCnpj.addEventListener('input', function (e) {
      let value = e.target.value.replace(/\D/g, '');
      if (value.length <= 11) {
        // CPF: 000.000.000-00
        value = value.replace(/(\d{3})(\d)/, '$1.$2');
        value = value.replace(/(\d{3})(\d)/, '$1.$2');
        value = value.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
      } 
      
      /*else {
        // CNPJ: 00.000.000/0000-00
        value = value.replace(/^(\d{2})(\d)/, '$1.$2');
        value = value.replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3');
        value = value.replace(/\.(\d{3})(\d)/, '.$1/$2');
        value = value.replace(/(\d{4})(\d)/, '$1-$2');
      }*/

      e.target.value = value;
    });
  }




  // Propriedade
  attachLettersNumbers(qs('#prop-nome'), 'Nome da propriedade');
  attachDecimal(qs('#prop-area-total'));
  //attachLettersOnly(qs('#prop-propriedade'), 'Proprietário');
  attachLettersOnly(qs('#prop-posse'), 'Condição de posse');
  applyCnpjMask(qs('#prop-cnpj'));
  attachMatricula13(qs('#prop-matricula'), qs('#prop-matricula-help'));

  // Required apenas em inputs editáveis
  qsa('input:not([readonly])').forEach(input => input.setAttribute('required', 'true'));
}


/* ============================================================
   ADICIONA UM PRODUTOR: Nome + CPF/CNPJ + Porte + Telefone
   - Não cria divisória para o conjunto base
   - "Sócio 1" aparece somente a partir do PRIMEIRO adicional
   ============================================================ */

// Contador para IDs únicos (o conjunto base já exibido = 1)
let clienteCount = 1;

function createSocioDivider(n) {
  const div = document.createElement('div');
  div.className = 'socio-divider';
  div.innerHTML = `<span class="label">Sócio ${n}</span>`;
  return div;
}

function addClientePair() {
  clienteCount += 1;
  const idx = clienteCount;

  const container = qs('#container-clientes');
  if (!container) return;

  // Número do sócio mostrado na divisória:
  // se idx=2 (primeiro adicional) -> Sócio 1; se idx=3 -> Sócio 2; ...
  const socioNumber = idx - 1;

  // 1) Divisória "Sócio N" ANTES dos campos
  container.appendChild(createSocioDivider(socioNumber));

  // 2) Nome
  const lblNome = document.createElement('label');
  const nomeId = `cliente-nome-${idx}`;
  lblNome.setAttribute('for', nomeId);
  lblNome.innerHTML = `
    Nome do(a) Produtor / Produtora
    <input type="text" id="${nomeId}" class="uppercase force-uppercase"
           placeholder="Digite o nome do(a) Produtor(a)"
           pattern="^[A-Za-zÀ-ÖØ-öø-ÿ\\s'-]+$" required />
  `;

  // 3) CPF
  const lblDoc = document.createElement('label');
  const docId = `cliente-cpfcnpj-${idx}`;
  const helpId = `cpfcnpj-help-${idx}`;
  lblDoc.setAttribute('for', docId);
  lblDoc.innerHTML = `
    CPF
    <input type="text" id="${docId}" inputmode="numeric" autocomplete="off"
           placeholder="Digite CPF ou CNPJ" maxlength="14" required />
    <small id="${helpId}" class="field-help" aria-live="polite"></small>
  `;

  // 4) Porte
  const lblPorte = document.createElement('label');
  const porteId = `cliente-porte-${idx}`;
  lblPorte.setAttribute('for', porteId);
  lblPorte.innerHTML = `
    Porte do produtor
    <select id="${porteId}" required>
      <option value="" disabled selected>Selecione o porte do produtor</option>
      <option value="PEQUENO PRODUTOR">Pequeno Produtor</option>
      <option value="MÉDIO PRODUTOR">Médio Produtor</option>
      <option value="GRANDE PRODUTOR">Grande Produtor</option>
    </select>
  `;

  // 5) Telefone
  const lblTel = document.createElement('label');
  const telId = `cliente-telefone-${idx}`;
  const telHelpId = `telefone-help-${idx}`;
  lblTel.setAttribute('for', telId);
  lblTel.innerHTML = `
    Telefone
    <input type="text" id="${telId}" placeholder="Digite o telefone"
           inputmode="numeric" autocomplete="tel" maxlength="16"
           pattern="^\\(\\d{2}\\)\\s9\\s\\d{4}-\\d{4}$" required />
    <small id="${telHelpId}" class="field-help"></small>
  `;

  // Adiciona ao container (grid-2 organiza em 2 colunas)
  container.appendChild(lblNome);
  container.appendChild(lblDoc);
  container.appendChild(lblPorte);
  container.appendChild(lblTel);

  // Máscaras/validações
  attachLettersOnly(qs(`#${nomeId}`), 'Nome do cliente');
  applyCpfCnpjMask(qs(`#${docId}`));
  initTelefoneMask(qs(`#${telId}`));

  // Required para inputs criados após boot
  [lblNome, lblDoc, lblPorte, lblTel].forEach(label => {
    qsa('input:not([readonly]), select:not([readonly])', label)
      .forEach(el => el.setAttribute('required', 'true'));
  });
}



/* ============================================================
   REMOVE O ÚLTIMO PRODUTOR ADICIONADO (divisória + 4 labels)
   Preserva o conjunto base (sem divisória)
   ============================================================ */

function removeClientePair() {
  const container = qs('#container-clientes');
  if (!container) return;

  // Se não houve nenhum adicional, não há .socio-divider no container
  const lastDivider = Array.from(container.querySelectorAll('.socio-divider')).pop();
  if (!lastDivider) {
    alert('Não há produtores adicionais para remover.');
    return;
  }

  // Remove do fim até apagar 4 labels referentes a esse sócio
  let removedLabels = 0;
  while (container.lastElementChild && removedLabels < 4) {
    const el = container.lastElementChild;
    if (el.tagName === 'LABEL') {
      el.remove();
      removedLabels++;
    } else {
      // Se chegar em outra divisória por engano, para (sanidade)
      if (el.classList && el.classList.contains('socio-divider')) break;
      el.remove();
    }
  }

  // Remove a divisória do último sócio
  if (container.lastElementChild && container.lastElementChild.classList.contains('socio-divider')) {
    container.lastElementChild.remove();
  } else if (lastDivider && lastDivider.parentNode) {
    // fallback: remove a última divisória encontrada
    lastDivider.remove();
  }

  // Atualiza contador (nunca menor que 1, pois 1 = base)
  if (typeof clienteCount === 'number') {
    clienteCount = Math.max(clienteCount - 1, 1);
  }
}


/* ============================================================
   ADICIONA UMA PROPRIEDADE COMPLETA: Nome + Área + Estado + Cidade + Matrícula + Posse + CNPJ + Situação
   - Base (sem divisória) já está no HTML, dentro do #container-propriedade
   - 1º clique => "Propriedade 1"
   ============================================================ */

let propriedadeCount = 0; // 0 => base sem divisória; primeiro add => Propriedade 1

function createPropriedadeDivider(n) {
  const div = document.createElement('div');
  div.className = 'socio-divider';
  div.innerHTML = `<span class="label">Propriedade ${n}</span>`;
  return div;
}

function addPropriedadeBlock() {
  // numerar a partir de 1, sem contar o bloco base
  propriedadeCount += 1;
  const idx = propriedadeCount;

  const container = qs('#container-propriedade');
  if (!container) return;

  // Divisória: Propriedade N
  container.appendChild(createPropriedadeDivider(idx));

  // Bloco completo (gerado com IDs únicos)
  const bloco = document.createElement('div');
  bloco.className = 'grid-2 propriedade-bloco';
  bloco.innerHTML = `
    <label for="prop-nome-${idx}">Nome da propriedade
      <input type="text" id="prop-nome-${idx}" class="uppercase force-uppercase"
             placeholder="Digite o nome da propriedade" required />
    </label>

    <label for="prop-area-${idx}">Área total (ha)
      <input type="text" id="prop-area-${idx}" placeholder="Digite a área total (ha)"
             inputmode="decimal" required />
    </label>

    <label for="prop-posse-${idx}">Condição de posse
      <input type="text" id="prop-posse-${idx}" placeholder="Digite a condição de posse"
             required />
    </label>

    <label for="prop-cnpj-${idx}">CNPJ do Proprietário
      <input type="text" id="prop-cnpj-${idx}" placeholder="Digite o CNPJ"
             inputmode="numeric" maxlength="18" required />
    </label>

    <label for="prop-estado-${idx}">Estado
      <select id="prop-estado-${idx}" required>
        <option value="" disabled selected>Selecione o estado (UF)</option>
      </select>
    </label>

    <label for="prop-cidade-${idx}">Cidade
      <input id="prop-cidade-${idx}" class="form-control as-select"
            placeholder="Buscar cidade..." list="dl-cidades-${idx}" required />
      <datalist id="dl-cidades-${idx}"></datalist>
    </label>

    <label for="prop-matricula-${idx}">Matrícula
      <input type="text" id="prop-matricula-${idx}" placeholder="Digite a matrícula"
             maxlength="13" required />
    </label>

    <!-- Situação da Propriedade -->
    <label for="prop-situacao-${idx}">Situação da Propriedade
        <select id="prop-situacao-${idx}" required>
        <option value="" disabled selected>Selecione a Situação da Propriedade</option>
        <option value="INDIVIDUAL">INDIVIDUAL</option>
        <option value="CONJUNTO">CONJUNTO</option>
      </select>
    </label>

    <!-- Valor Terra Nua (dinâmico) -->
      <label for="prop-terra-nua-${idx}">Valor Terra Nua
          <input type="text" id="prop-terra-nua-${idx}" class="money"
           inputmode="numeric" placeholder="0,00" required />
    </label>
  `;

  container.appendChild(bloco);

  // === Máscaras e validações para o bloco criado ===
  attachLettersNumbers(qs(`#prop-nome-${idx}`), 'Nome da propriedade');
  attachDecimal(qs(`#prop-area-${idx}`));
  attachLettersOnly(qs(`#prop-posse-${idx}`), 'Condição de posse');
  applyCnpjMask(qs(`#prop-cnpj-${idx}`));
  attachMatricula13(qs(`#prop-matricula-${idx}`));


  // Valor Terra Nua (dinâmico)
  maskBRL(qs(`#prop-terra-nua-${idx}`));

  // === UF e Cidade (datalist) para o bloco criado ===
  carregarUFsComFallback(qs(`#prop-estado-${idx}`));

  // popula o datalist quando muda a UF
  qs(`#prop-estado-${idx}`).addEventListener('change', async () => {
    const uf = qs(`#prop-estado-${idx}`).value;
    const dl = qs(`#dl-cidades-${idx}`);
    dl.innerHTML = '';

    try {
      const res = await fetch('static/json/estados-cidades.json', { cache: 'no-cache' });
      const dataset = await res.json();
      const estado = (dataset?.estados || []).find(e => e.sigla === uf);
      const cidades = Array.isArray(estado?.cidades) ? estado.cidades.slice() : [];
      cidades.sort((a, b) => a.localeCompare(b, 'pt-BR'));
      cidades.forEach(nome => {
        const o = document.createElement('option');
        o.value = nome;
        dl.appendChild(o);
      });
    } catch (err) {
      console.error('Falha ao carregar lista de cidades:', err);
    }
  });
}

/* ============================================================
   REMOVE UMA PROPRIEDADE COMPLETA
   ============================================================ */
function removePropriedadeBlock() {
  const container = qs('#container-propriedade');
  if (!container) return;

  const blocks = container.querySelectorAll('.propriedade-bloco:not(.propriedade-bloco--base)');
  const dividers = container.querySelectorAll('.socio-divider');

  if (blocks.length === 0) {
    alert('Não há propriedades adicionais para remover.');
    return;
  }

  blocks[blocks.length - 1].remove();
  dividers[dividers.length - 1]?.remove();

  propriedadeCount = Math.max(propriedadeCount - 1, 0);
}

/* ============================================================
   Máscara CNPJ (reuso)
   ============================================================ */
function applyCnpjMask(inputEl) {
  if (!inputEl) return;
  inputEl.addEventListener('input', function (e) {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 14) value = value.slice(0, 14);
    value = value.replace(/^(\d{2})(\d)/, '$1.$2');
    value = value.replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3');
    value = value.replace(/\.(\d{3})(\d)/, '.$1/$2');
    value = value.replace(/(\d{4})(\d)/, '$1-$2');
    e.target.value = value;
  });
}




/* ============================================================
    HELPER CRIADO PARA DIVIDIR OS CAMPOS DOS DADOS DO PRODUTOR
   ============================================================ */

// Máscara dinâmica CPF/CNPJ para qualquer input (reuso)
function applyCpfCnpjMask(inputEl) {
  if (!inputEl) return;
  inputEl.addEventListener('input', function (e) {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length <= 11) {
      // CPF: 000.000.000-00
      value = value.replace(/(\d{3})(\d)/, '$1.$2');
      value = value.replace(/(\d{3})(\d)/, '$1.$2');
      value = value.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    } else {
      // CNPJ: 00.000.000/0000-00
      value = value.replace(/^(\d{2})(\d)/, '$1.$2');
      value = value.replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3');
      value = value.replace(/\.(\d{3})(\d)/, '.$1/$2');
      value = value.replace(/(\d{4})(\d)/, '$1-$2');
    }
    e.target.value = value;
  });
}

/*=============================================================
    LISTAS DE ANOS SUSPENSAS
   ============================================================*/


/* ============================================================
   Opções padronizadas de Ano (usadas em Produção Agrícola)
   ============================================================ */
const ANO_OPTIONS = `
  <option value="" disabled selected>Ano</option>
  <option value="2024 / 2025">2024 / 2025</option>
  <option value="2025 / 2026">2025 / 2026</option>
  <option value="2026 / 2027">2026 / 2027</option>
  <option value="2027 / 2028">2027 / 2028</option>
  <option value="2028 / 2029">2028 / 2029</option>
  <option value="2029 / 2030">2029 / 2030</option>

`;

/* ============================================================
   Opções padronizadas de Ano (usadas em Pecuária)
   ============================================================ */
const ANOCIVIL_OPTIONS = `
  <option value="" disabled selected>Ano</option>
  <option value="2024">2024</option>
  <option value="2025">2025</option>
  <option value="2026">2026</option>
  <option value="2027">2027</option>
  <option value="2028">2028</option>
  <option value="2029">2029</option>
  <option value="2030">2030</option>
`;

/* ============================================================
   AGRÍCOLA
   ============================================================ */
function initAgricola() {
  const tbody = qs('#tbl-agricola tbody');
  addRowAgricola(tbody, '2025 / 2026', 'CAFÉ ARÁBICA', 1.31, 32);
  addRowAgricola(tbody, '2025 / 2026', 'MILHO', 2, 50);
}


// Opções de Unidade (dropdown)
const UND_OPTIONS = `
  <option value="" disabled selected>Unid.</option>
  <option value="kg/ha">KG/ha</option>
  <option value="ton/ha">TON/ha</option>
  <option value="sacas/ha">SACA/ha</option>
  <option value="caixas/ha">CAIXA/ha</option>
`;


function addRowAgricola(tbody, ano = '', cultura = '', area = 0, prod = 0) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>
      <select class="ag-ano" required>
        ${ANO_OPTIONS}
      </select>
    </td>

    <td>
      <input type="text" class="ag-cultura uppercase force-uppercase"
             value="${cultura}" placeholder="Digite a cultura" required />
    </td>
    
    <td>
      <select class="ag-und" required>
        ${UND_OPTIONS}
      </select>
    </td>


    <td><input value="${String(area).replace('.', ',')}" class="ag-area" /></td>
    <td><input value="${String(prod).replace('.', ',')}" class="ag-produtividade" /></td>
    <td><input class="ag-producao" readonly /></td>
    <td><input class="ag-saldo" readonly /></td>
    <td><button class="btn btn-remove" type="button">Remover</button></td>
  `;
  tbody.appendChild(tr);

  
// APLICAR MÁSCARAS DECIMAIS
maskDecimalBR(tr.querySelector('.ag-area'));
maskDecimalBR(tr.querySelector('.ag-produtividade'));


  // Seleciona cultura se fornecida
  const selCultura = tr.querySelector('.ag-cultura');
  if (cultura) selCultura.value = cultura;

  // Eventos para recalcular quando mudar qualquer campo
  const debouncedCalc = debounce(() => calcAgricolaRow(tr), 120);
  qsa('input, select', tr).forEach(inp => inp.addEventListener('input', debouncedCalc));

  tr.querySelector('.btn-remove').addEventListener('click', () => {
    tr.remove();
    recalcAll();
  });

  calcAgricolaRow(tr);
}

function calcAgricolaRow(tr) {
  const area = num(tr.querySelector('.ag-area').value);
  const prod = num(tr.querySelector('.ag-produtividade').value);
  const culturaKey = tr.querySelector('.ag-cultura').value.trim().toUpperCase();
  const preco = statePrecos.get(culturaKey) || 0;
  const producao = area * prod;
  const saldo = producao * preco;
  tr.querySelector('.ag-producao').value = String(producao.toFixed(2)).replace('.', ',');
  tr.querySelector('.ag-saldo').value = brl(saldo);
  recalcAgricolaTotal();
}





/* ============================================================
   PECUÁRIA
   ============================================================ */
function initPecuaria() {
  const tbody = qs('#tbl-pecuaria tbody');
  addRowPecuaria(tbody, '2025', 'BOVINOCULTURA DE CORTE', 5, 2.6, 13, 17);
}


// Opções de Unidade (dropdown)
const UND_OPTIONSCORTE = `
  <option value="" disabled selected>Unid.</option>
  <option value="@Boi">@</option>
  <option value="Kg">KG</option>
  <option value="Carcaca">CARCAÇA</option>
`;


function addRowPecuaria(
  tbody,
  ano = '',
  atividade = '',
  ua_ha = 0,
  area_util = 0,
  qtd = 0,
  peso = 0
) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>
      <select class="pec-ano" required>
        ${ANOCIVIL_OPTIONS}
      </select>
    </td>

    <!-- CAMPO DIGITÁVEL SUBSTITUINDO O SELECT -->
    <td>
      <input type="text" class="pec-atividade uppercase force-uppercase"
             value="${atividade}" placeholder="Digite a atividade" required />
    </td>

    <td>
      <select class="c-und-medida-corte" required>
        ${UND_OPTIONSCORTE}
      </select>
    </td>

    <td><input value="${String(ua_ha).replace('.', ',')}" class="pec-ua" /></td>
    <td><input value="${String(area_util).replace('.', ',')}" class="pec-area" /></td>
    <td><input value="${String(qtd).replace('.', ',')}" class="pec-qtd" /></td>
    <td><input value="${String(peso).replace('.', ',')}" class="pec-peso" /></td>
    <td><input class="pec-producao" readonly /></td>
    <td><input class="pec-saldo" readonly /></td>
    <td><button class="btn btn-remove" type="button">Remover</button></td>
  `;
  tbody.appendChild(tr);

  
// 🔥 AQUI! — aplica validação para aceitar apenas letras (com acentos)
  attachLettersOnly(tr.querySelector('.pec-atividade'), 'Atividade');


  // Seleciona Ano se veio preenchido
  const selAno = tr.querySelector('.pec-ano');
  if (ano) {
    const hasAno = Array.from(selAno.options).some(opt => opt.value === ano);
    if (!hasAno) {
      const optAno = document.createElement('option');
      optAno.value = ano;
      optAno.textContent = ano;
      selAno.insertBefore(optAno, selAno.options[1] || null);
    }
    selAno.value = ano;
  }

  // Eventos para recalcular
  const debouncedCalc = debounce(() => calcPecuariaRow(tr), 120);
  qsa('input, select', tr).forEach(inp =>
    inp.addEventListener('input', debouncedCalc)
  );

  tr.querySelector('.btn-remove').addEventListener('click', () => {
    tr.remove();
    recalcAll();
  });

  calcPecuariaRow(tr);
}

function calcPecuariaRow(tr) {
  const qtd = num(tr.querySelector('.pec-qtd').value);
  const peso = num(tr.querySelector('.pec-peso').value);
  const producao = qtd * peso; // produção = quantidade × peso (@/UA)
  
  const culturaKey = tr.querySelector('.pec-atividade').value.trim().toUpperCase();
  const preco = statePrecos.get(culturaKey) || 0;

  const saldo = producao * preco;
  tr.querySelector('.pec-producao').value = String(producao.toFixed(2)).replace('.', ',');
  tr.querySelector('.pec-saldo').value = brl(saldo);
  recalcPecuariaTotal();
}



/* ============================================================
   PECUÁRIA – LEITE
   ============================================================ */

function initPecuariaLeite() {
  const tbody = qs('#tbl-pecuaria-leite tbody');
  addRowPecuariaLeite(tbody, '2025', 'PECUÁRIA LEITEIRA', 18, 3.5, 20);
}

function addRowPecuariaLeite(
  tbody,
  ano = '',
  atividade = '',
  litros_dia = 0,
  area_util = 0,
  vacas = 0
) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>
      <select class="pl-ano" required>
        ${ANOCIVIL_OPTIONS}
      </select>
    </td>

    <td>
      <input type="text" class="pl-atividade uppercase force-uppercase"
             value="${atividade}" placeholder="Digite a atividade" required />
    </td>

    <td><input value="${String(litros_dia).replace('.', ',')}" class="pl-produt"/></td>
    <td><input value="${String(area_util).replace('.', ',')}" class="pl-area"/></td>

    <!-- VACAS EM LACTAÇÃO — SOMENTE INTEIRO -->
    <td><input value="${String(vacas)}" class="pl-vacas"/></td>

    <td><input class="pl-producao-total" readonly /></td>
    <td><input class="pl-saldo" readonly /></td>
    <td><button class="btn btn-remove" type="button">Remover</button></td>
  `;
  tbody.appendChild(tr);

  // Apenas letras na atividade
  attachLettersOnly(tr.querySelector('.pl-atividade'), 'Atividade');

  // Máscaras numéricas decimais
  maskDecimalBR(tr.querySelector('.pl-produt'));
  maskDecimalBR(tr.querySelector('.pl-area'));

  // 🔥 APLICAR MÁSCARA DE NÚMERO INTEIRO EM VACAS
  maskInteger(tr.querySelector('.pl-vacas'));

  // Seleciona ano
  const selAno = tr.querySelector('.pl-ano');
  if (ano) selAno.value = ano;

  // Cálculo automático
  const debounced = debounce(() => calcPecuariaLeiteRow(tr), 120);
  qsa('input, select', tr).forEach(el =>
    el.addEventListener('input', debounced)
  );

  tr.querySelector('.btn-remove').addEventListener('click', () => {
    tr.remove();
    recalcPecuariaLeiteTotal();
  });

  calcPecuariaLeiteRow(tr);
}



function calcPecuariaLeiteRow(tr) {
  const prodDia = num(tr.querySelector('.pl-produt').value);
  const vacas   = parseInt(num(tr.querySelector('.pl-vacas').value)) || 0;

  const producaoTotal = prodDia * vacas * 30;
  const precoLeite    = statePrecos.get('PECUÁRIA LEITEIRA') || 0;

  tr.querySelector('.pl-producao-total').value = String(producaoTotal.toFixed(2)).replace('.', ',');
  tr.querySelector('.pl-saldo').value          = brl(producaoTotal * precoLeite);

  recalcPecuariaLeiteTotal();
}


function recalcPecuariaLeiteTotal() {
  const total = qsa('#tbl-pecuaria-leite .pl-saldo').reduce((acc, el) => {
    const v = el.value.replace(/[R$.\s]/g, '').replace(',', '.');
    return acc + (parseFloat(v) || 0);
  }, 0);

  qs('#total-renda-leiteira-tabela').textContent = brl(total);
}



/* ============================================================
   PRODUÇÃO CULTURA DIVERSA
   ============================================================ */

// Opções de Unidade (dropdown)
const UND_OPTIONSCULTURADIVERSA = `
  <option value="" disabled selected>Unid.</option>
  <option value="@Boi">@</option>
  <option value="Kg">KG</option>
  <option value="Carcaca">CARCAÇA</option>
  <option value="kg/ha">KG/ha</option>
  <option value="ton/ha">TON/ha</option>
  <option value="sacas/ha">SACA/ha</option>
  <option value="caixas/ha">CAIXA/ha</option>
`;

function addRowCulturadiversa(
  tbody,
  ano = '',
  atividade = '',
  tipoatividade = '',
  ovelhas = 0,
  produtividade = 0 // kg de lã por ovelha (período base definido por você)
) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>
      <select class="la-ano" required>
        ${ANOCIVIL_OPTIONS}
      </select>
    </td>

    <td>
      <input type="text" class="la-atividade uppercase force-uppercase"
             value="${atividade}" placeholder="Digite a atividade" required />
    </td>

    <td>
      <input type="text" class="culturadiversa-tipoatvidade uppercase force-uppercase"
             value="${tipoatividade}" placeholder="Digite o tipo de atividade" required />
    </td>

    <!-- Qtd Cultura Diversa -->
    <td>
      <input 
        value="${String(Math.trunc(ovelhas))}" 
        class="la-ovelhas"
        inputmode="numeric"
        pattern="^\\d+$"
        title="Digite apenas números inteiros"
      />
    </td>

    <td>
      <select class="la-ano" required>
        ${UND_OPTIONSCULTURADIVERSA}
      </select>
    </td>


    <!-- Produtividade = DECIMAL -->
    <td>
      <input value="${String(produtividade).replace('.', ',')}" class="la-produt" />
    </td>

    <td><input class="la-producao-total" readonly /></td>
    <td><input class="la-saldo"          readonly /></td>

    <td><button class="btn btn-remove" type="button">Remover</button></td>
  `;
  tbody.appendChild(tr);

  // Validações/máscaras
  attachLettersOnly(tr.querySelector('.la-atividade'), 'Atividade');

  // 🔢 produtividade é decimal (kg/ovelha)
  maskDecimalBR(tr.querySelector('.la-produt'));

  // 🔢 ovelhas é INTEIRO (APLICAR A MÁSCARA AQUI!)
  maskInteger(tr.querySelector('.la-ovelhas'));

  // Seleciona ano inicial (se fornecido)
  const selAno = tr.querySelector('.la-ano');
  if (ano) selAno.value = ano;

  // Eventos — cálculo automático
  const debounced = debounce(() => calcLaRow(tr), 120);
  qsa('input, select', tr).forEach(el => el.addEventListener('input', debounced));

  tr.querySelector('.btn-remove').addEventListener('click', () => {
    tr.remove();
    recalcLaTotal();
  });

  // Cálculo inicial
  calcLaRow(tr);
}

function calcLaRow(tr) {
  // Garante INTEIRO, mesmo que algo escape
  const qtdOvelhas = parseInt(num(tr.querySelector('.la-ovelhas').value)) || 0;
  const produt     = num(tr.querySelector('.la-produt').value);

  const producaoTotal = qtdOvelhas * produt;

  const precoLa = statePrecos.get('LÃ') || 0;

  tr.querySelector('.la-producao-total').value = String(producaoTotal.toFixed(2)).replace('.', ',');
  tr.querySelector('.la-saldo').value          = brl(producaoTotal * precoLa);

  recalcLaTotal();
}

function recalcLaTotal() {
  const total = qsa('#tbl-culturadiversa .la-saldo').reduce((acc, el) => {
    const v = el.value.replace(/[R$.\s]/g, '').replace(',', '.');
    return acc + (parseFloat(v) || 0);
  }, 0);

  qs('#total-renda-culturadiversa-tabela').textContent = brl(total);
}



/* ============================================================
   HISTÓRICO (COM CÁLCULO AUTOMÁTICO)
   ============================================================ */

function initHistorico() {
  const tbody = qs('#tbl-historico tbody');
  
  addRowHistorico(tbody, '2024 / 2025', 'CAFÉ ARÁBICA', 1.31, 29, 37.99, 66672.45);
  addRowHistorico(tbody, '2025 / 2026', 'CAFÉ ARÁBICA', 1.31, 32, 41.92, 73569.60);
  addRowHistorico(tbody, '2024 / 2025', 'MILHO', 2, 50, 100, 6300);
  addRowHistorico(tbody, '2025 / 2026', 'MILHO', 2, 50, 100, 6300);
}

/* ============================================================
   ADICIONA LINHA COM CÁLCULO IGUAL AS OUTRAS TABELAS
   ============================================================ */
function addRowHistorico(
  tbody,
  ano = '',
  cultura = '',
  area = 0,
  prod = 0,
  producao = 0,
  saldo = 0
) {
  const tr = document.createElement("tr");

  tr.innerHTML = `
    <td>
      <select class="hist-ano" required>
        ${ANO_OPTIONS}
      </select>
    </td>

    <td>
      <input type="text" 
             class="hist-cultura uppercase force-uppercase"
             value="${cultura}" 
             placeholder="Digite a cultura / atividade" 
             required />
    </td>

    <td><input value="${String(area).replace(".", ",")}" class="hist-area" /></td>
    <td><input value="${String(prod).replace(".", ",")}" class="hist-produtividade" /></td>

    <td><input value="${String(producao).replace(".", ",")}" class="hist-producao" readonly /></td>
    <td><input value="${brl(num(saldo))}" class="hist-saldo" readonly /></td>

    <td><button class="btn btn-remove" type="button">Remover</button></td>
  `;

  tbody.appendChild(tr);

  /* ===== Máscaras ===== */
  maskDecimalBR(tr.querySelector(".hist-area"));
  maskDecimalBR(tr.querySelector(".hist-produtividade"));
  attachLettersOnly(tr.querySelector(".hist-cultura"), "Cultura");

  /* ===== Ano ===== */
  const selAno = tr.querySelector(".hist-ano");
  if (ano) {
    const exists = Array.from(selAno.options).some(o => o.value === ano);
    if (!exists) {
      const opt = document.createElement("option");
      opt.value = ano;
      opt.textContent = ano;
      selAno.insertBefore(opt, selAno.options[1]);
    }
    selAno.value = ano;
  }

  /* ===== Remover linha ===== */
  tr.querySelector(".btn-remove").addEventListener("click", () => {
    tr.remove();
  });

  /* ===== Cálculo automático ===== */
  const debounced = debounce(() => calcHistoricoRow(tr), 120);
  qsa("input, select", tr).forEach(el =>
    el.addEventListener("input", debounced)
  );

  /* ===== Cálculo inicial ===== */
  calcHistoricoRow(tr);
}

/* ============================================================
   CÁLCULO DA LINHA
   ============================================================ */
function calcHistoricoRow(tr) {
  const area    = num(tr.querySelector(".hist-area").value);
  const prod    = num(tr.querySelector(".hist-produtividade").value);
  const cultura = tr.querySelector(".hist-cultura").value.trim().toUpperCase();

  // produção = área × produtividade
  const producao = area * prod;
  tr.querySelector(".hist-producao").value =
    String(producao.toFixed(2)).replace(".", ",");

  // preço da tabela statePrecos
  const preco = statePrecos.get(cultura) || 0;

  // saldo = produção × preço
  const saldo = producao * preco;
  tr.querySelector(".hist-saldo").value = brl(saldo);
}


/* ============================================================
   REBANHO
   ============================================================ */

function initRebanho() {
  const itens = [
    ['De 0 até 12 meses', 'Macho', 0],
    ['De 0 até 12 meses', 'Fêmea', 4],
    ['De 13 até 24 meses', 'Macho', 0],
    ['De 13 até 24 meses', 'Fêmea', 5],
    ['De 25 até 36 meses', 'Macho', 1],
    ['De 25 até 36 meses', 'Fêmea', 0],
    ['Acima de 36 meses', 'Macho', 0],
    ['Acima de 36 meses', 'Fêmea', 3],
  ];
  const tbody = qs('#tbl-rebanho tbody');

  // Agora addRowRebanho aceita também o valor unitário (valund). Como na sua planilha
  // inicial não há valor, passamos 0. Se tiver valores, basta preencher o 4º parâmetro.
  itens.forEach(([faixa, sexo, qtd, valund = 0]) =>
    addRowRebanho(tbody, faixa, sexo, qtd, valund)
  );

  recalcRebanhoTotals();
}

/* ===== TOTALIZADORES DO REBANHO (ÚNICA FUNÇÃO) =====
   - total de cabeças (quantidade)
   - total em R$ (soma de quantidade * valor unitário)
*/
function recalcRebanhoTotals() {
  // Total de cabeças
  const totalQtd = qsa('.reb-qtd').reduce((acc, inp) => acc + num(inp.value), 0);
  const elQtd = qs('#total-rebanho');
  if (elQtd) elQtd.textContent = String(totalQtd);

  // Total em R$ (qtd * valor)
  const totalValor = qsa('#tbl-rebanho tbody tr').reduce((acc, tr) => {
    const qtd = num(tr.querySelector('.reb-qtd')?.value);
    const vStr = tr.querySelector('.reb-valor')?.value || '';
    const v = Number(vStr.replace(/\./g, '').replace(',', '.')) || 0; // BR -> número
    return acc + (qtd * v);
  }, 0);

  const elVal = qs('#total-valor-rebanho');
  if (elVal) elVal.textContent = brl(totalValor);
}

/* ===== ADICIONAR LINHA AO REBANHO =====
   Mantém a mesma assinatura, com 4º parâmetro opcional (valund)
*/
function addRowRebanho(tbody, faixa = '', sexo = '', quantidade = 0, valund = 0) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input value="${faixa}" class="reb-faixa" placeholder="Faixa etária" /></td>
    <td>
      <select class="reb-sexo">
        <option value="" disabled selected>Selecione</option>
        <option value="Macho" ${sexo === 'Macho' ? 'selected' : ''}>Macho</option>
        <option value="Fêmea" ${sexo === 'Fêmea' ? 'selected' : ''}>Fêmea</option>
      </select>
    </td>

    <!-- Quantidade (inteiro) -->
    <td><input value="${String(quantidade)}" class="reb-qtd" inputmode="numeric" /></td>

    <!-- Valor Unitário (BRL) -->
    <td><input class="reb-valor" placeholder="0,00" /></td>

    <td><button class="btn btn-remove" type="button">Remover</button></td>
  `;
  tbody.appendChild(tr);

  // Validações/máscaras
  attachLettersNumbers(tr.querySelector('.reb-faixa'), 'Faixa etária'); // letras+números e acentos
  maskInteger(tr.querySelector('.reb-qtd')); // somente inteiro

  // Máscara BRL no valor unitário
  const valorInput = tr.querySelector('.reb-valor');
  maskBRL(valorInput);

  // Se vier valor inicial (número), formatamos para BR
  if (valund) {
    valorInput.value = Number(valund)
      .toFixed(2)
      .replace('.', ',')
      .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  // Recalcular totais ao digitar/trocar
  const debounced = debounce(() => recalcRebanhoTotals(), 120);
  tr.querySelector('.reb-qtd').addEventListener('input', debounced);
  valorInput.addEventListener('input', debounced);
  tr.querySelector('.reb-sexo').addEventListener('change', debounced);

  // Remover linha
  tr.querySelector('.btn-remove').addEventListener('click', () => {
    tr.remove();
    recalcRebanhoTotals();
  });

  // Cálculo imediato
  recalcRebanhoTotals();
}




/* ============================================================
   BENS
   ============================================================ */
function initBens() {
  const itens = [
    ['TRATOR - SOLIS 26 4WD', 'SOLIS26/GTRA4WD', 2022, 'VERMELHO', 107000],
    ['ADUBADEIRA', 'M535B/MINAMI', 2022, 'LARANJA', 21000],
    ['PULVERIZADOR', 'KUHN/ AF600', 2023, 'CINZA/LARANJA', 32375],
    ['ROCHADEIRA', 'AT8160', 2020, 'VERMELHA', 15000],
  ];
  const tbody = qs('#tbl-bens tbody');
  itens.forEach(item => addRowBem(tbody, ...item));
}

function addRowBem(tbody, desc = '', modelo = '', ano = '', cor = '', valor = 0) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input value="${desc}" class="bem-desc" /></td>
    <td><input value="${modelo}" class="bem-modelo" /></td>
    <td><input value="${ano}" class="bem-ano" /></td>
    <td><input value="${cor}" class="bem-cor" /></td>
    <td><input value="${String(valor).replace('.', ',')}" class="bem-valor" /></td>
    <td><button class="btn btn-remove" type="button">Remover</button></td>
  `;
  tbody.appendChild(tr);

  tr.querySelector('.btn-remove').addEventListener('click', () => {
    tr.remove();
    recalcBensTotal();
  });

  const debounced = debounce(() => recalcBensTotal(), 120);
  qsa('input', tr).forEach(inp => inp.addEventListener('input', debounced));

  recalcBensTotal();
}

function recalcBensTotal() {
  const total = qsa('.bem-valor').reduce((acc, inp) => acc + num(inp.value), 0);
  qs('#total-bens').textContent = brl(total);
}


/* ============================================================
   TOTALIZADORES – CÁLCULOS GERAIS (VERSÃO CORRIGIDA)
   ============================================================ */

/* --------- AGRÍCOLA --------- */
function recalcAgricolaTotal() {
  const total = qsa('#tbl-agricola .ag-saldo').reduce((acc, inp) => {
    const val = inp.value.replace(/[R$.\s]/g, '').replace(',', '.');
    return acc + (parseFloat(val) || 0);
  }, 0);

  qs('#total-renda-agricola').textContent  = brl(total);
  qs('#renda-total-agricola').textContent  = brl(total);

  recalcRendaTotal();
}

/* --------- PECUÁRIA DE CORTE --------- */
function recalcPecuariaTotal() {
  const total = qsa('#tbl-pecuaria .pec-saldo').reduce((acc, inp) => {
    const val = inp.value.replace(/[R$.\s]/g, '').replace(',', '.');
    return acc + (parseFloat(val) || 0);
  }, 0);

  document.querySelectorAll('#total-renda-agropecuaria, #total-renda-agropecuaria-tabela')
  .forEach(el => el.textContent = brl(total));

  recalcRendaTotal();
}

/* --------- PECUÁRIA LEITEIRA --------- */
function recalcPecuariaLeiteTotal() {
  // Usa a classe CORRETA na tabela leiteira: .pl-saldo
  const total = qsa('#tbl-pecuaria-leite .pl-saldo').reduce((acc, el) => {
    const v = el.value.replace(/[R$.\s]/g, '').replace(',', '.');
    return acc + (parseFloat(v) || 0);
  }, 0);

  document.querySelectorAll('#total-renda-leiteira, #total-renda-leiteira-tabela')
  .forEach(el => el.textContent = brl(total));
  recalcRendaTotal();
}

/* --------- LÃ --------- */
function recalcLaTotal() {
  const total = qsa('#tbl-culturadiversa .la-saldo').reduce((acc, el) => {
    const v = el.value.replace(/[R$.\s]/g, '').replace(',', '.');
    return acc + (parseFloat(v) || 0);
  }, 0);

  
  document.querySelectorAll('#total-renda-culturadiversa, #total-renda-culturadiversa-tabela')
  .forEach(el => el.textContent = brl(total));

  recalcRendaTotal();
}



/* --------- SOMA GERAL (recalcula direto das tabelas) --------- */
function recalcRendaTotal() {
  // Evita depender de IDs (que podem estar duplicados no HTML)
  const totalAg     = qsa('#tbl-agricola .ag-saldo').reduce((a, el) => a + (parseFloat(el.value.replace(/[R$.\s]/g, '').replace(',', '.')) || 0), 0);
  const totalCorte  = qsa('#tbl-pecuaria .pec-saldo').reduce((a, el) => a + (parseFloat(el.value.replace(/[R$.\s]/g, '').replace(',', '.')) || 0), 0);
  const totalLeite  = qsa('#tbl-pecuaria-leite .pl-saldo').reduce((a, el) => a + (parseFloat(el.value.replace(/[R$.\s]/g, '').replace(',', '.')) || 0), 0);
  const totalculturadiversa     = qsa('#tbl-culturadiversa .la-saldo').reduce((a, el) => a + (parseFloat(el.value.replace(/[R$.\s]/g, '').replace(',', '.')) || 0), 0);


  const totalPecuaria = totalCorte + totalLeite + totalculturadiversa;

  // Atualiza o card de totais
  const outAg     = qs('#renda-total-agricola');   if (outAg)     outAg.textContent = brl(totalAg);
  const outPec    = qs('#renda-total-pecuaria');   if (outPec)    outPec.textContent = brl(totalPecuaria);
  const outGeral  = qs('#renda-total');            if (outGeral)  outGeral.textContent = brl(totalAg + totalPecuaria);
}

/* --------- RE-CALCULAR TUDO --------- */
function recalcAll() {
  qsa('#tbl-agricola tbody tr').forEach(tr => calcAgricolaRow(tr));
  qsa('#tbl-pecuaria tbody tr').forEach(tr => calcPecuariaRow(tr));
  qsa('#tbl-pecuaria-leite tbody tr').forEach(tr => calcPecuariaLeiteRow(tr));
  qsa('#tbl-culturadiversa tbody tr').forEach(tr => calcLaRow(tr));
}



/* ============================================================
   Botões "Adicionar"
   ============================================================ */
function bindAddButtons() {
  const btnAddCliente = qs('#btn-add-cliente');
  if (btnAddCliente) btnAddCliente.addEventListener('click', addClientePair);

  const btnRemoveCliente = qs('#btn-remove-cliente');
  if (btnRemoveCliente) btnRemoveCliente.addEventListener('click', removeClientePair);

  const btnAddRebanho = qs('#btn-add-rebanho');
  if (btnAddRebanho) btnAddRebanho.addEventListener('click', () =>
    addRowRebanho(qs('#tbl-rebanho tbody'))
  );

  const btnAddPreco = qs('#btn-add-preco');
  if (btnAddPreco) btnAddPreco.addEventListener('click', addRowPrecoEmpty);

  const btnAddPecLeite = qs('#btn-add-pecuaria-leite');
  if (btnAddPecLeite) btnAddPecLeite.addEventListener('click', () =>
    addRowPecuariaLeite(qs('#tbl-pecuaria-leite tbody'))
  );

  const btnAddLa = qs('#btn-add-culturadiversa');
  if (btnAddLa) btnAddLa.addEventListener('click', () =>
    addRowCulturadiversa(qs('#tbl-culturadiversa tbody'))
  );

  // ✅ Propriedade (versões seguras)
  const btnAddProp = qs('#btn-add-propriedade');
  if (btnAddProp) btnAddProp.addEventListener('click', addPropriedadeBlock);

  const btnRemoveProp = qs('#btn-remove-propriedade');
  if (btnRemoveProp) btnRemoveProp.addEventListener('click', removePropriedadeBlock);

  // Demais
  const btnAddAgr = qs('#btn-add-agricola');
  if (btnAddAgr) btnAddAgr.addEventListener('click', () =>
    addRowAgricola(qs('#tbl-agricola tbody'))
  );

  const btnAddHist = qs('#btn-add-historico');
  if (btnAddHist) btnAddHist.addEventListener('click', () =>
    addRowHistorico(qs('#tbl-historico tbody'), '', '', '', '', '', '')
  );

  const btnAddPec = qs('#btn-add-pecuaria');
  if (btnAddPec) btnAddPec.addEventListener('click', () =>
    addRowPecuaria(qs('#tbl-pecuaria tbody'))
  );

  const btnAddBem = qs('#btn-add-bem');
  if (btnAddBem) btnAddBem.addEventListener('click', () =>
    addRowBem(qs('#tbl-bens tbody'))
  );
}

/* ============================================================
   Estados/Cidades OFFLINE para Propriedade (JSON local) — com busca (datalist) no campo CIDADE
   ============================================================ */
async function initEstadosCidadesOffline() {
  const ufSelect = qs('#prop-estado');
  const cidadeSelect = qs('#prop-cidade');            // hidden para envio/required
  const cidadeSearch = qs('#prop-cidade-search');     // input visível para o usuário
  const dl = qs('#dl-cidades');                       // datalist

  const limparSelect = (select, placeholder) => {
    select.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = '';
    opt.disabled = true;
    opt.selected = true;
    opt.textContent = placeholder;
    select.appendChild(opt);
  };

  const habilitar = (el, enabled) => { el.disabled = !enabled; };

  // Sincroniza o que o usuário escolheu no input para o select (form submit)
  function syncCidadeToSelect(nomeCidade) {
    const nome = (nomeCidade || '').trim();
    if (!nome) {
      cidadeSelect.value = '';
      cidadeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    // Procura option existente no select
    const opt = Array.from(cidadeSelect.options)
      .find(o => o.value === nome || o.textContent === nome);

    if (opt) {
      cidadeSelect.value = opt.value;
    } else {
      // Se não existir (digitação manual exata), adiciona
      const novo = document.createElement('option');
      novo.value = nome;
      novo.textContent = nome;
      cidadeSelect.appendChild(novo);
      cidadeSelect.value = nome;
    }
    cidadeSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Eventos do campo de busca
  cidadeSearch.addEventListener('change', (e) => {
    syncCidadeToSelect(e.target.value);
  });
  cidadeSearch.addEventListener('blur', (e) => {
    syncCidadeToSelect(e.target.value);
  });

  try {
    const res = await fetch('static/json/estados-cidades.json', { cache: 'no-cache' });
    const dataset = await res.json();

    const estados = Array.isArray(dataset?.estados) ? dataset.estados.slice() : [];
    estados.sort((a, b) => a.sigla.localeCompare(b.sigla, 'pt-BR'));

    // Preenche UF (como no seu código)
    limparSelect(ufSelect, 'Selecione o estado (UF)');
    estados.forEach(({ sigla, nome }) => {
      const opt = document.createElement('option');
      opt.value = sigla;
      opt.textContent = `${sigla} – ${nome}`;
      ufSelect.appendChild(opt);
    });
    habilitar(ufSelect, true);

    // Estado inicial da cidade: desabilitado, sem itens
    limparSelect(cidadeSelect, 'Selecione a cidade');
    dl.innerHTML = '';
    cidadeSearch.value = '';
    habilitar(cidadeSelect, false);
    cidadeSearch.disabled = true;

    // Ao mudar UF: preencher select e datalist, habilitar cidadeSearch
    ufSelect.addEventListener('change', () => {
      const uf = ufSelect.value;
      const estado = estados.find(e => e.sigla === uf);
      const cidades = Array.isArray(estado?.cidades) ? estado.cidades.slice() : [];
      cidades.sort((a, b) => a.localeCompare(b, 'pt-BR'));

      // 1) Preenche o select oculto (para form)
      limparSelect(cidadeSelect, 'Selecione a cidade');
      cidades.forEach(nome => {
        const opt = document.createElement('option');
        opt.value = nome;
        opt.textContent = nome;
        cidadeSelect.appendChild(opt);
      });

      // 2) Preenche o datalist visível (para busca)
      dl.innerHTML = '';
      cidades.forEach(nome => {
        const o = document.createElement('option');
        o.value = nome;
        dl.appendChild(o);
      });

      // 3) Habilita o input de cidade e limpa valor anterior
      cidadeSearch.value = '';
      cidadeSearch.disabled = false;     // usuário pode digitar
      habilitar(cidadeSelect, true);     // mantém o select válido para o form

      // Opcional: focar automaticamente no campo de busca
      // cidadeSearch.focus();
    });
  } catch (err) {
    console.error('Falha ao carregar estados-cidades.json:', err);

    // Fallback mínimo (como no seu código)
    limparSelect(ufSelect, 'Selecione o estado (UF)');
    ['MG'].forEach(sigla => {
      const opt = document.createElement('option');
      opt.value = sigla;
      opt.textContent = `${sigla} – Minas Gerais`;
      ufSelect.appendChild(opt);
    });
    habilitar(ufSelect, true);

    const fallbackCidades = ['Guaranésia', 'Guaxupé', 'Belo Horizonte'];

    // Select oculto
    limparSelect(cidadeSelect, 'Selecione a cidade');
    fallbackCidades.forEach(nome => {
      const opt = document.createElement('option');
      opt.value = nome;
      opt.textContent = nome;
      cidadeSelect.appendChild(opt);
    });

    // Datalist de busca
    dl.innerHTML = '';
    fallbackCidades.forEach(nome => {
      const o = document.createElement('option');
      o.value = nome;
      dl.appendChild(o);
    });

    cidadeSearch.value = '';
    cidadeSearch.disabled = false;
    habilitar(cidadeSelect, true);
  }
}

/* ============================================================
   GERADOR DE ESQUELETO PDF (Estrutura limpa para impressão)
   ============================================================ */
function generatePDFSkeleton() {
  // Cria container principal
  const container = document.createElement('div');
  container.id = 'pdf-skeleton';
  container.style.width = '100%';
  container.style.padding = '20px';
  container.style.boxSizing = 'border-box';
  container.style.fontFamily = 'Arial, sans-serif';
  container.style.fontSize = '12px';
  container.style.color = '#000';
  container.style.background = '#fff';

  // Helpers
  const val = (id) => { const el = document.getElementById(id); return el ? (el.value || '') : ''; };
  const text = (id) => { const el = document.getElementById(id); return el ? el.textContent : ''; };

  // --- CABEÇALHO ---
  const header = document.createElement('div');
  header.style.textAlign = 'center';
  header.style.marginBottom = '20px';
  header.style.borderBottom = '2px solid #003641';
  header.style.paddingBottom = '10px';
  header.innerHTML = `
    <img src="static/img/logo_credinter.png" style="height: 60px; margin-bottom: 10px;">
    <h1 style="margin: 0; color: #003641; font-size: 22px; text-transform: uppercase;">Laudo de Levantamento e Estimativa de Produção</h1>
  `;
  container.appendChild(header);

  // --- 1. DADOS DO PRODUTOR ---
  const section1 = document.createElement('div');
  section1.style.marginBottom = '20px';
  section1.innerHTML = `<h2 style="background: #e0f2f1; padding: 8px; color: #004d40; border-left: 5px solid #004d40; font-size: 16px; margin-bottom: 10px;">1. DADOS DO PRODUTOR(A)</h2>`;
  
  let prodTable = `<table style="width: 100%; border-collapse: collapse; font-size: 12px;">
    <tr style="background: #f5f5f5;">
      <th style="border: 1px solid #ccc; padding: 6px; text-align: left;">Nome</th>
      <th style="border: 1px solid #ccc; padding: 6px; text-align: left;">CPF/CNPJ</th>
      <th style="border: 1px solid #ccc; padding: 6px; text-align: left;">Porte</th>
      <th style="border: 1px solid #ccc; padding: 6px; text-align: left;">Telefone</th>
    </tr>`;
  
  // Produtor Base
  prodTable += `<tr>
    <td style="border: 1px solid #ccc; padding: 6px;">${val('cliente-nome')}</td>
    <td style="border: 1px solid #ccc; padding: 6px;">${val('cliente-cpfcnpj')}</td>
    <td style="border: 1px solid #ccc; padding: 6px;">${val('cliente-porte')}</td>
    <td style="border: 1px solid #ccc; padding: 6px;">${val('cliente-telefone')}</td>
  </tr>`;

  // Produtores Adicionais
  const extraProds = document.querySelectorAll('#container-clientes input[id^="cliente-nome-"]');
  extraProds.forEach(input => {
      const idx = input.id.split('-').pop();
      prodTable += `<tr>
        <td style="border: 1px solid #ccc; padding: 6px;">${input.value}</td>
        <td style="border: 1px solid #ccc; padding: 6px;">${val(`cliente-cpfcnpj-${idx}`)}</td>
        <td style="border: 1px solid #ccc; padding: 6px;">${val(`cliente-porte-${idx}`)}</td>
        <td style="border: 1px solid #ccc; padding: 6px;">${val(`cliente-telefone-${idx}`)}</td>
      </tr>`;
  });
  prodTable += `</table>`;
  section1.innerHTML += prodTable;
  container.appendChild(section1);

  // --- 2. PROPRIEDADES ---
  const section2 = document.createElement('div');
  section2.style.marginBottom = '20px';
  section2.innerHTML = `<h2 style="background: #e0f2f1; padding: 8px; color: #004d40; border-left: 5px solid #004d40; font-size: 16px; margin-bottom: 10px;">2. PROPRIEDADE(S)</h2>`;

  let propTable = `<table style="width: 100%; border-collapse: collapse; font-size: 11px;">
    <tr style="background: #f5f5f5;">
      <th style="border: 1px solid #ccc; padding: 5px; text-align: left;">Nome</th>
      <th style="border: 1px solid #ccc; padding: 5px; text-align: left;">Área (ha)</th>
      <th style="border: 1px solid #ccc; padding: 5px; text-align: left;">Posse</th>
      <th style="border: 1px solid #ccc; padding: 5px; text-align: left;">Matrícula</th>
      <th style="border: 1px solid #ccc; padding: 5px; text-align: left;">Localização</th>
      <th style="border: 1px solid #ccc; padding: 5px; text-align: left;">Situação</th>
      <th style="border: 1px solid #ccc; padding: 5px; text-align: left;">Terra Nua</th>
    </tr>`;

  // Propriedade Base
  propTable += `<tr>
    <td style="border: 1px solid #ccc; padding: 5px;">${val('prop-nome')}</td>
    <td style="border: 1px solid #ccc; padding: 5px;">${val('prop-area-total')}</td>
    <td style="border: 1px solid #ccc; padding: 5px;">${val('prop-posse')}</td>
    <td style="border: 1px solid #ccc; padding: 5px;">${val('prop-matricula')}</td>
    <td style="border: 1px solid #ccc; padding: 5px;">${val('prop-estado')} - ${val('prop-cidade')}</td>
    <td style="border: 1px solid #ccc; padding: 5px;">${val('prop-situacao')}</td>
    <td style="border: 1px solid #ccc; padding: 5px;">${val('prop-terra-nua')}</td>
  </tr>`;

  // Propriedades Adicionais
  const extraProps = document.querySelectorAll('.propriedade-bloco:not(.propriedade-bloco--base) input[id^="prop-nome-"]');
  extraProps.forEach(input => {
      const idx = input.id.split('-').pop();
      propTable += `<tr>
        <td style="border: 1px solid #ccc; padding: 5px;">${input.value}</td>
        <td style="border: 1px solid #ccc; padding: 5px;">${val(`prop-area-${idx}`)}</td>
        <td style="border: 1px solid #ccc; padding: 5px;">${val(`prop-posse-${idx}`)}</td>
        <td style="border: 1px solid #ccc; padding: 5px;">${val(`prop-matricula-${idx}`)}</td>
        <td style="border: 1px solid #ccc; padding: 5px;">${val(`prop-estado-${idx}`)} - ${val(`prop-cidade-${idx}`)}</td>
        <td style="border: 1px solid #ccc; padding: 5px;">${val(`prop-situacao-${idx}`)}</td>
        <td style="border: 1px solid #ccc; padding: 5px;">${val(`prop-terra-nua-${idx}`)}</td>
      </tr>`;
  });
  propTable += `</table>`;
  section2.innerHTML += propTable;
  container.appendChild(section2);

  // --- TABELAS DINÂMICAS ---
  const createTableFromDOM = (domTableId, title) => {
      const domTable = document.querySelector(domTableId);
      if (!domTable) return null;
      const rows = domTable.querySelectorAll('tbody tr');
      if (rows.length === 0) return null;

      const wrapper = document.createElement('div');
      wrapper.style.marginBottom = '20px';
      wrapper.style.breakInside = 'avoid';
      if (title) wrapper.innerHTML = `<h3 style="border-bottom: 1px solid #ccc; padding-bottom: 5px; color: #333; font-size: 14px; margin-bottom: 8px;">${title}</h3>`;

      const table = document.createElement('table');
      table.style.width = '100%';
      table.style.borderCollapse = 'collapse';
      table.style.fontSize = '11px';

      // Header
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      headerRow.style.backgroundColor = '#f0f0f0';
      const domThs = domTable.querySelectorAll('thead th');
      let colCount = 0;
      const skipIndices = [];
      domThs.forEach((th, idx) => {
          if (th.classList.contains('c-acoes') || th.textContent.trim() === 'Ações' || th.textContent.trim() === '') {
              skipIndices.push(idx); return;
          }
          const newTh = document.createElement('th');
          newTh.textContent = th.textContent;
          newTh.style.border = '1px solid #ccc';
          newTh.style.padding = '5px';
          newTh.style.textAlign = 'left';
          headerRow.appendChild(newTh);
          colCount++;
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      // Body
      const tbody = document.createElement('tbody');
      rows.forEach(row => {
          const newRow = document.createElement('tr');
          row.querySelectorAll('td').forEach((cell, idx) => {
              if (skipIndices.includes(idx)) return;
              const newCell = document.createElement('td');
              newCell.style.border = '1px solid #ccc';
              newCell.style.padding = '5px';
              const input = cell.querySelector('input, select');
              newCell.textContent = input ? input.value : cell.textContent;
              newRow.appendChild(newCell);
          });
          tbody.appendChild(newRow);
      });
      table.appendChild(tbody);

      // Footer
      const domFoot = domTable.querySelector('tfoot');
      if (domFoot) {
          const tfoot = document.createElement('tfoot');
          domFoot.querySelectorAll('tr').forEach(row => {
              const newRow = document.createElement('tr');
              row.querySelectorAll('td').forEach((cell, idx) => {
                  if (skipIndices.includes(idx)) return;
                  const newCell = document.createElement('td');
                  newCell.style.border = '1px solid #ccc';
                  newCell.style.padding = '5px';
                  newCell.style.fontWeight = 'bold';
                  newCell.style.backgroundColor = '#fafafa';
                  newCell.innerHTML = cell.innerHTML;
                  if (cell.hasAttribute('colspan') && idx === 0) newCell.setAttribute('colspan', colCount - 1);
                  newRow.appendChild(newCell);
              });
              tfoot.appendChild(newRow);
          });
          table.appendChild(tfoot);
      }
      wrapper.appendChild(table);
      return wrapper;
  };

  const tables = [
      {id: '#tbl-precos', title: 'Preços do Produto'},
      {id: '#tbl-agricola', title: 'Produção Agrícola'},
      {id: '#tbl-pecuaria', title: 'Pecuária de Corte'},
      {id: '#tbl-pecuaria-leite', title: 'Pecuária Leiteira'},
      {id: '#tbl-culturadiversa', title: 'Cultura Diversa'},
      {id: '#tbl-historico', title: 'Histórico de Produção'},
      {id: '#tbl-rebanho', title: 'Rebanho Existente'},
      {id: '#tbl-bens', title: 'Bens'}
  ];
  tables.forEach(t => { const el = createTableFromDOM(t.id, t.title); if (el) container.appendChild(el); });

  // --- RESUMO FINANCEIRO ---
  const summary = document.createElement('div');
  summary.style.marginTop = '20px';
  summary.style.marginBottom = '20px';
  summary.style.padding = '15px';
  summary.style.border = '1px solid #ddd';
  summary.style.borderRadius = '5px';
  summary.style.backgroundColor = '#f9f9f9';
  summary.style.breakInside = 'avoid';
  summary.innerHTML = `
    <h3 style="margin-top: 0; margin-bottom: 10px; color: #004d40;">Resumo Financeiro</h3>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 12px;">
      <div><strong>Total Agrícola:</strong> ${text('renda-total-agricola')}</div>
      <div><strong>Total Pecuária:</strong> ${text('renda-total-pecuaria')}</div>
      <div><strong>Total Diversos:</strong> ${text('total-renda-culturadiversa-tabela') || 'R$ 0,00'}</div>
      <div style="grid-column: 1 / -1; margin-top: 10px; font-size: 14px; color: #003641; border-top: 1px solid #ccc; padding-top: 5px;">
        <strong>Total Geral: ${text('renda-total')}</strong>
      </div>
    </div>
  `;
  container.appendChild(summary);

  // --- GALERIA ---
  const galleryImgs = document.querySelectorAll('#galeria-imagens img');
  if (galleryImgs.length > 0) {
      const galSection = document.createElement('div');
      galSection.style.breakInside = 'avoid';
      galSection.innerHTML = `<h3 style="border-bottom: 1px solid #ccc; padding-bottom: 5px; color: #333; font-size: 14px;">Galeria Fotográfica</h3>`;
      const grid = document.createElement('div');
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
      grid.style.gap = '10px';
      galleryImgs.forEach(img => {
          const imgContainer = document.createElement('div');
          imgContainer.style.width = '100%';
          imgContainer.style.height = '150px';
          imgContainer.style.border = '1px solid #eee';
          imgContainer.style.backgroundColor = '#fff';
          imgContainer.style.backgroundRepeat = 'no-repeat';
          imgContainer.style.backgroundPosition = 'center center';
          imgContainer.style.backgroundSize = 'contain';
          imgContainer.style.backgroundImage = `url('${img.src}')`;
          grid.appendChild(imgContainer);
      });
      galSection.appendChild(grid);
      container.appendChild(galSection);
  }

  // --- DADOS DO AGRÔNOMO ---
  const agroSection = document.createElement('div');
  agroSection.style.marginTop = '30px';
  agroSection.style.borderTop = '2px solid #003641';
  agroSection.style.paddingTop = '10px';
  agroSection.style.breakInside = 'avoid';
  agroSection.innerHTML = `
    <h3 style="margin: 0 0 10px 0; color: #003641; font-size: 14px;">Responsável Técnico</h3>
    <table style="width: 100%; font-size: 12px;">
      <tr>
        <td style="padding: 4px;"><strong>Nome:</strong> ${val('cliente-resp-tec')}</td>
        <td style="padding: 4px;"><strong>CREA/CFTA:</strong> ${val('cliente-crea')}</td>
      </tr>
      <tr>
        <td colspan="2" style="padding: 4px;"><strong>Observação:</strong> ${val('cliente-observacao')}</td>
      </tr>
      <tr>
        <td colspan="2" style="padding: 4px;"><strong>Data:</strong> ${val('cliente-data')}</td>
      </tr>
    </table>
    <div style="margin-top: 40px; text-align: center;">
      <div style="border-top: 1px solid #000; width: 60%; margin: 0 auto; padding-top: 5px;">
        Assinatura do Responsável Técnico
      </div>
    </div>
  `;
  container.appendChild(agroSection);

  return container;
}

/* ============================================================
   Galeria de Imagens (IndexedDB + compressão WebP opcional)
   ============================================================ */
function initGaleria() {
  const btnAdd = qs('#btn-add-imagens');
  const inputFiles = qs('#input-imagens');
  const galeria = qs('#galeria-imagens');

  const ALLOWED_TYPES = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
    'image/heic', 'image/heif'
  ];
  const MAX_SIZE_MB = 16;
  const WEBP_QUALITY = 0.85;
  const MAX_WIDTH = 2560;

  const DB_NAME = 'galeriaDB';
  const STORE = 'imagens';
  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('date', 'date', { unique: false });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function dbAddImage(file) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const record = {
        name: file.name,
        type: file.type,
        date: Date.now(),
        blob: file,
      };
      const req = store.add(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbGetAllImages() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbDeleteImage(id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  const formatMB = (bytes) => (bytes / (1024 * 1024)).toFixed(2);

  function isTypeAllowed(file) {
    if (ALLOWED_TYPES.includes(file.type)) return true;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const mapExtToMime = {
      jpg: 'image/jpg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
      gif: 'image/gif', heic: 'image/heic', heif: 'image/heif',
    };
    const guessed = mapExtToMime[ext];
    return guessed ? ALLOWED_TYPES.includes(guessed) : false;
  }

  async function compressToWebP(file, quality = WEBP_QUALITY, maxWidth = MAX_WIDTH) {
    try {
      const bitmap = await createImageBitmap(file);
      const { width, height } = bitmap;
      const scale = width > maxWidth ? maxWidth / width : 1;
      const targetW = Math.round(width * scale);
      const targetH = Math.round(height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;

      const ctx = canvas.getContext('2d', { alpha: true });
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);

      const blob = await new Promise(resolve =>
        canvas.toBlob(resolve, 'image/webp', quality)
      );
      if (!blob) throw new Error('Falha ao gerar blob WebP');

      const newName = file.name.replace(/\.\w+$/, '.webp');
      return new File([blob], newName, { type: 'image/webp' });
    } catch (err) {
      console.warn('createImageBitmap falhou, tentando fallback via <img>:', err);
      const dataURL = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });

      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = dataURL;
      });

      const { width, height } = img;
      const scale = width > maxWidth ? maxWidth / width : 1;
      const targetW = Math.round(width * scale);
      const targetH = Math.round(height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;

      const ctx = canvas.getContext('2d', { alpha: true });
      ctx.drawImage(img, 0, 0, targetW, targetH);

      const blob = await new Promise(resolve =>
        canvas.toBlob(resolve, 'image/webp', quality)
      );
      if (!blob) throw new Error('Falha ao gerar blob WebP (fallback)');

      const newName = file.name.replace(/\.\w+$/, '.webp');
      return new File([blob], newName, { type: 'image/webp' });
    }
  }

  function createItem({ id, blob, name }) {
    const url = URL.createObjectURL(blob);

    const item = document.createElement('div');
    item.className = 'galeria-item';
    item.dataset.id = id;

    const img = document.createElement('img');
    img.src = url;
    img.alt = name || 'imagem';

    const btnRemover = document.createElement('button');
    btnRemover.type = 'button';
    btnRemover.className = 'btn-remove-thumb';
    btnRemover.innerHTML = `
      <span class="sr-only">Remover imagem</span>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 3h6a1 1 0 0 1 1 1v2h4v2h-1v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8H4V6h4V4a1 1 0 0 1 1-1zm1 3h4V4h-4v2zM8 8v12h8V8H8zm2 3h2v7h-2v-7zm4 0h2v7h-2v-7z"/>
      </svg>
    `;
    btnRemover.addEventListener('click', async () => {
      try {
        await dbDeleteImage(id);
        URL.revokeObjectURL(url);
        item.remove();
      } catch (err) {
        console.error('Erro ao remover imagem:', err);
        alert('Não foi possível remover a imagem.');
      }
    });

    item.appendChild(img);
    item.appendChild(btnRemover);
    galeria.appendChild(item);
  }

  async function renderAllFromDB() {
    galeria.innerHTML = '';
    const all = await dbGetAllImages();
    all.sort((a, b) => a.date - b.date);
    all.forEach(rec => createItem(rec));
  }

  (async function init() {
    try {
      db = await openDB();
      await renderAllFromDB();
    } catch (err) {
      console.error('IndexedDB indisponível:', err);
    }
  })();

  btnAdd.addEventListener('click', () => inputFiles.click());

  inputFiles.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    for (const file of files) {
      const sizeMB = file.size / (1024 * 1024);

      if (!isTypeAllowed(file)) {
        alert(`Tipo não suportado: ${file.type || '(desconhecido)'}.\nUse JPG/PNG/WebP/GIF. HEIC/HEIF serão convertidos automaticamente se possível.`);
        continue;
      }

      let fileToSave = file;

      // Converter HEIC/HEIF
      if (file.type === 'image/heic' || file.type === 'image/heif' || /\.heic$|\.heif$/i.test(file.name)) {
        try {
          const convertido = await compressToWebP(fileToSave, 0.90, MAX_WIDTH);
          fileToSave = convertido;
        } catch (e) {
          console.error('Falha ao converter HEIC/HEIF:', e);
          alert('Imagem HEIC/HEIF não pôde ser convertida neste navegador. Exporte para JPG/PNG e tente novamente.');
          continue;
        }
      }

      // Comprimir se grande
      if (sizeMB > MAX_SIZE_MB) {
        try {
          const convertido = await compressToWebP(fileToSave, WEBP_QUALITY, MAX_WIDTH);
          const newSizeMB = convertido.size / (1024 * 1024);
          if (newSizeMB > MAX_SIZE_MB) {
            alert(`Mesmo após compressão, a imagem ficou com ${newSizeMB.toFixed(2)} MB (> ${MAX_SIZE_MB} MB).`);
            continue;
          }
          fileToSave = convertido;
        } catch (e) {
          console.error('Não foi possível comprimir imagem grande:', e);
          alert('Não foi possível comprimir a imagem grande. Reduza resolução/qualidade e tente novamente.');
          continue;
        }
      }

      // Salvar
      try {
        const id = await dbAddImage(fileToSave);
        createItem({ id, blob: fileToSave, name: fileToSave.name });
      } catch (err) {
        console.error('Erro ao salvar no IndexedDB:', err);
        if (String(err).includes('QuotaExceededError')) {
          alert('Espaço local insuficiente para salvar mais imagens. Remova algumas e tente novamente.');
        } else {
          alert('Não foi possível salvar a imagem localmente.');
        }
      }
    }

    inputFiles.value = '';
  });
}


/* ============================================================
   PDF (html2pdf) — compressão iterativa com barra de progresso
   - Gera PDF a partir de #export-area
   - Tenta reduzir qualidade/escala até ficar <= 500KB
   - Mostra barra de progresso em #pdf-progress
   ============================================================ */

function initPDF() {
  const btn = qs('#btn-gerar-pdf');
  if (!btn) return;

  const progressWrap = qs('#pdf-progress');
  const progressBar = qs('#pdf-progress-bar');
  const progressStatus = qs('#pdf-progress-status');
  const progressPercent = qs('#pdf-progress-percent');

  function updateProgress(p, msg) {
    if (progressBar) progressBar.style.width = Math.max(0, Math.min(100, p)) + '%';
    if (progressPercent) progressPercent.textContent = Math.round(p) + '%';
    if (progressStatus && msg) progressStatus.textContent = msg;
  }

  async function compressImgElement(imgEl, quality = 0.85, maxDim = 1400) {
    return new Promise((resolve, reject) => {
      try {
        const src = imgEl.src || '';
        if (!src) return resolve();
        const image = new Image();
        // Do not set crossOrigin for data URLs (can break loading); only set for http(s) resources
        if (!src.startsWith('data:')) image.crossOrigin = 'Anonymous';
        image.onload = () => {
          try {
            const w = image.naturalWidth || image.width;
            const h = image.naturalHeight || image.height;
            let ratio = 1;
            const max = Math.max(w, h);
            if (max > maxDim) ratio = maxDim / max;
            const cw = Math.max(1, Math.round(w * ratio));
            const ch = Math.max(1, Math.round(h * ratio));
            const canvas = document.createElement('canvas');
            canvas.width = cw;
            canvas.height = ch;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, cw, ch);
            ctx.drawImage(image, 0, 0, cw, ch);
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            imgEl.src = dataUrl;
            resolve();
          } catch (err) {
            console.warn('compressImgElement inner error', err);
            resolve();
          }
        };
        image.onerror = () => resolve();
        image.src = src;
      } catch (err) {
        resolve();
      }
    });
  }

  btn.addEventListener('click', async () => {
    const filename = 'laudo-agronegocio.pdf';
    const maxBytes = 500 * 1024; // 500 KB
    btn.disabled = true;
    if (progressWrap) progressWrap.style.display = 'block';
    updateProgress(2, 'Preparando conteúdo...');
    document.documentElement.classList.add('pdf-export');

    // GERA O ESQUELETO DO PDF (em vez de clonar a tela)
    const clone = generatePDFSkeleton();
    
    // Coloca em container offscreen
    const off = document.createElement('div');
    off.style.position = 'fixed';
    off.style.left = '-10000px';
    off.style.top = '0';
    off.style.width = 'auto';
    off.appendChild(clone);
    document.body.appendChild(off);

    try {
      // Initial compression of images in clone
      const imgs = Array.from(clone.querySelectorAll('img'));
      let i = 0;
      for (const el of imgs) {
        i++;
        updateProgress(3 + (i / Math.max(1, imgs.length)) * 10, `Comprimindo imagens (${i}/${imgs.length})`);
        await compressImgElement(el, 0.85, 1400);
      }

      // Attempts with decreasing quality/scale
      const attempts = [
        { q: 0.95, scale: 2 },
        { q: 0.9, scale: 1.8 },
        { q: 0.85, scale: 1.6 },
        { q: 0.8, scale: 1.4 },
        { q: 0.75, scale: 1.2 },
        { q: 0.65, scale: 1 }
      ];

      let success = false;
      for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
        const a = attempts[attemptIndex];
        updateProgress(15 + (attemptIndex / attempts.length) * 60, `Gerando PDF (tentativa ${attemptIndex + 1}/${attempts.length})`);
        // Before generating, recompress all images in the clone to the target quality/size
        try {
          const imgsForAttempt = Array.from(clone.querySelectorAll('img'));
          let j = 0;
          // maxDim scales inversely with html2canvas scale to keep pixel count reasonable
          const maxDim = Math.max(600, Math.round(1400 / a.scale));
          for (const el of imgsForAttempt) {
            j++;
            updateProgress(15 + (j / Math.max(1, imgsForAttempt.length)) * 10, `Recomprimindo imagens (${j}/${imgsForAttempt.length})`);
            await compressImgElement(el, Math.max(0.15, a.q), maxDim);
          }
          
          const opt = {
            margin: 2,
            filename,
            image: { type: 'jpeg', quality: a.q },
            html2canvas: { scale: a.scale, useCORS: true, background: '#ffffff', scrollY: 0, windowWidth: document.documentElement.scrollWidth },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
            pagebreak: { mode: ['css', 'legacy'], before: ['.card:not(:first-of-type)'], avoid: ['.card', '.table-wrapper', 'table', '.galeria-item', '.pdf-gallery-page'] },
          };

          // Generate PDF and access jsPDF instance to get blob size
          const jspdfInstance = await html2pdf().set(opt).from(clone).toPdf().get('pdf');
          // output as blob
          const blob = jspdfInstance.output('blob');
          const kb = Math.round(blob.size / 1024);
          updateProgress(40 + ((attemptIndex + 1) / attempts.length) * 40, `Tamanho atual ${kb} KB`);

          if (blob.size <= maxBytes) {
            // automatic download
            jspdfInstance.save(filename);
            success = true;
            break;
          }
          // otherwise loop to next attempt with lower quality/scale
        } catch (err) {
          console.error('Erro ao gerar PDF (tentativa):', err);
        }
      }

      if (!success) {
        updateProgress(90, 'Não foi possível atingir 500KB — baixando versão final.');
        try {
          await html2pdf().set({ margin: 2, filename, image: { type: 'jpeg', quality: 0.5 }, html2canvas: { scale: 1, useCORS: true, background: '#ffffff', scrollY: 0, windowWidth: document.documentElement.scrollWidth }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }, pagebreak: { mode: ['css', 'legacy'], before: ['.card:not(:first-of-type)'], avoid: ['.card', '.table-wrapper', 'table', '.galeria-item', '.pdf-gallery-page'] } }).from(clone).save();
        } catch (err) {
          console.error('Fallback save erro:', err);
          alert('Erro ao gerar PDF.');
        }
      }
    } finally {
      document.documentElement.classList.remove('pdf-export');
      btn.disabled = false;
      updateProgress(100, 'Concluído');
      setTimeout(() => {
        if (progressWrap) progressWrap.style.display = 'none';
        try { off.remove(); } catch (e) {}
      }, 800);
    }
  });
}

// Inicializa o PDF handler ao carregar o script
initPDF();

/* ============================================================
   TESTE (SEARCH)
   ============================================================ */

function makeSelectWithSearch(selectEl) {
  // Cria um wrapper para simular o select
  const wrapper = document.createElement('div');
  wrapper.className = 'custom-select-wrapper';
  selectEl.parentNode.insertBefore(wrapper, selectEl);
  wrapper.appendChild(selectEl);

  // Cria o container do dropdown
  const dropdown = document.createElement('div');
  dropdown.className = 'custom-dropdown';
  dropdown.style.display = 'none';

  // Campo de busca
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Buscar cidade...';
  searchInput.className = 'search-input';

  // Lista de opções
  const optionsContainer = document.createElement('div');
  optionsContainer.className = 'options-container';

  dropdown.appendChild(searchInput);
  dropdown.appendChild(optionsContainer);
  wrapper.appendChild(dropdown);

  // Estilo básico
  wrapper.style.position = 'relative';
  dropdown.style.position = 'absolute';
  dropdown.style.top = '100%';
  dropdown.style.left = '0';
  dropdown.style.width = '100%';
  dropdown.style.background = '#fff';
  dropdown.style.border = '1px solid #ccc';
  dropdown.style.zIndex = '999';

  // Abre/fecha dropdown
  selectEl.addEventListener('click', () => {
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    renderOptions();
  });

  // Renderiza opções
  function renderOptions(filter = '') {
    optionsContainer.innerHTML = '';
    const opts = Array.from(selectEl.options).filter(opt => opt.value && !opt.disabled);
    opts.forEach(opt => {
      if (opt.textContent.toLowerCase().includes(filter.toLowerCase())) {
        const div = document.createElement('div');
        div.textContent = opt.textContent;
        div.className = 'option-item';
        div.style.padding = '5px';
        div.style.cursor = 'pointer';
        div.addEventListener('click', () => {
          selectEl.value = opt.value;
          dropdown.style.display = 'none';
        });
        optionsContainer.appendChild(div);
      }
    });
  }

  // Filtra ao digitar
  searchInput.addEventListener('input', () => {
    renderOptions(searchInput.value);
  });

  // Fecha ao clicar fora
  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}




/* ============================================================
   MASCARAS PARA OS CARDS - Preços do Produto - Coluna (Preço Atual)
   ============================================================ */


function maskBRL(inputEl) {
  inputEl.addEventListener("input", function () {
    let v = this.value.replace(/\D/g, ""); // mantém apenas números

    if (!v) {
      this.value = "";
      return;
    }

    // Converte os últimos dois dígitos em centavos
    v = (parseInt(v, 10) / 100).toFixed(2);

    // Formata como BRL sem símbolo
    v = v
      .replace('.', ',')               // decimal brasileiro
      .replace(/\B(?=(\d{3})+(?!\d))/g, "."); // milhares

    this.value = v;
  });

  inputEl.addEventListener("blur", function () {
    if (!this.value) return;

    // garante formatação final com 2 casas decimais
    let v = this.value.replace(/\./g, '').replace(',', '.');
    v = Number(v).toFixed(2);

    this.value = v
      .replace('.', ',')
      .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  });
}



/* ============================================================
   MASCARAS PARA OS CARDS - Produção Agrícola - Coluna (Área(ha) e Produtividade(ha))
   ============================================================ */


function maskDecimalBR(inputEl) {
  inputEl.addEventListener("input", function () {
    let v = this.value.replace(/\D/g, ""); // só números

    if (!v) {
      this.value = "";
      return;
    }

    // últimos 2 dígitos são decimais
    v = (parseInt(v, 10) / 100).toFixed(2);

    // Formata: vírgula como decimal, ponto como milhar
    v = v
      .replace('.', ',')
      .replace(/\B(?=(\d{3})+(?!\d))/g, ".");

    this.value = v;
  });

  inputEl.addEventListener("blur", function () {
    if (!this.value) return;

    let v = this.value.replace(/\./g, '').replace(',', '.');
    v = Number(v).toFixed(2);

    this.value = v
      .replace('.', ',')
      .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  });
}




/* ============================================================
   Cultura Diversa – Inicialização (sem linha inicial por padrão)
   ============================================================ */
function initCulturadiversa() {
  // Se quiser linha inicial automática, descomente a linha abaixo:
  // addRowCulturadiversa(qs('#tbl-la tbody'), '2025 / 2026', 'PRODUÇÃO DE LÃ', 0, 0);
}










/* ============================================================
   Boot (Único ponto de inicialização)
   ============================================================ */

document.addEventListener('input', (e) => {
  if (e.target && e.target.classList.contains('preco-fonte')) {
    const pos = e.target.selectionStart;
    e.target.value = e.target.value.toUpperCase();
    e.target.setSelectionRange(pos, pos);
  }
});

/* ============================================================
   Boot (Data Hoje)
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  const inputData = document.querySelector("#cliente-data");
  if (inputData) {
    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = String(hoje.getMonth() + 1).padStart(2, "0");
    const dia = String(hoje.getDate()).padStart(2, "0");
    inputData.value = `${ano}-${mes}-${dia}`;
  }
});


function boot() {
  // Tabelas e dados base
  initPrecos();
  initAgricola();
  initHistorico();
  initPecuaria();         // corte
  initPecuariaLeite();    // leite  ✅ garantir chamada
  initCulturadiversa();               // lã      ✅ agora existe
  initRebanho();
  initBens();

  // Form + required
  initFormMasks();

  // Estados/cidades (offline JSON) para Propriedade
  initEstadosCidadesOffline();

  // Botões
  bindAddButtons();

  // Galeria
  initGaleria();

  // PDF
  //initPDF();
}


if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(console.error);
  });
}

  // Atualizar site (limpa cache e SW)
  const btnAtualizar = qs('#btn-atualizar-site');
  if (btnAtualizar) {
    btnAtualizar.addEventListener('click', async () => {
      if (!confirm('Deseja forçar a atualização do site? A versão mais recente será carregada.')) {
        return;
      }

      try {
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.getRegistration();
          if (registration && registration.active) {
            // 1. Tenta limpar o cache via mensagem para o SW
            registration.active.postMessage({ type: 'CLEAR_CACHES' });
            console.log('Mensagem CLEAR_CACHES enviada ao Service Worker.');
          }

          // 2. Desregistra TODOS os service workers para garantir a instalação do novo
          const registrations = await navigator.serviceWorker.getRegistrations();
          if (registrations.length) {
            await Promise.all(registrations.map(reg => reg.unregister()));
            console.log(`${registrations.length} Service Worker(s) desregistrado(s).`);
          }
        }

        // 3. Limpa todos os caches do cliente como garantia final
        const keys = await caches.keys();
        if (keys.length) {
          await Promise.all(keys.map(key => caches.delete(key)));
          console.log(`Caches (${keys.join(', ')}) limpos com sucesso.`);
        }

        alert('O site será recarregado para aplicar a atualização.');
        
        // 4. Recarrega a página, forçando a busca de novos recursos da rede
        window.location.reload(true);

      } catch (err) {
        console.error('Falha ao tentar atualizar o site:', err);
        alert('Ocorreu um erro ao tentar atualizar. Verifique o console para mais detalhes e, se possível, limpe o cache do navegador manualmente.');
      }
    });
  }

window.addEventListener('DOMContentLoaded', boot);
