(function () {
  'use strict';

  const TIPO_LABEL = {
    combustivel: 'Combustível',
    manutencao_veiculo: 'Manutenção de Veículo',
    uniformes_epis: 'Uniformes e EPIs',
    materiais_ferramentas: 'Materiais e Ferramentas'
  };

  const STATUS_LABEL = {
    recebido: 'Recebido',
    em_analise: 'Em análise',
    separando_material: 'Separando material',
    pronto_retirada: 'Pronto p/ retirada',
    concluido: 'Concluído',
    cancelado: 'Cancelado'
  };

  const STATUS_ORDEM = ['recebido', 'em_analise', 'separando_material', 'pronto_retirada', 'concluido', 'cancelado'];

  let solicitacoesCache = [];
  let custosCache = [];
  let itensLivresCount = 0;
  let repetidosSet = new Set(); // ids de solicitações com pelo menos 1 item repetido
  let graficoTipo, graficoCidade, graficoEquipe;
  let graficoCustoMaterial, graficoCustoEquipe, graficoCustoCidade;

  // ------------------------------------------------------------------
  // Elementos
  // ------------------------------------------------------------------
  const telaLogin = document.getElementById('tela-login');
  const painel = document.getElementById('painel');
  const formLogin = document.getElementById('form-login');
  const loginErro = document.getElementById('login-erro');
  const usuarioLogado = document.getElementById('usuario-logado');

  // ------------------------------------------------------------------
  // AUTENTICAÇÃO
  // ------------------------------------------------------------------
  async function verificarSessao() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      mostrarPainel(session);
    } else {
      telaLogin.hidden = false;
      painel.hidden = true;
    }
  }

  formLogin.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    loginErro.hidden = true;

    const email = document.getElementById('login-email').value.trim();
    const senha = document.getElementById('login-senha').value;

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: senha });

    if (error) {
      loginErro.textContent = '⚠️ E-mail ou senha inválidos.';
      loginErro.hidden = false;
      return;
    }
    mostrarPainel(data.session);
  });

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    location.reload();
  });

  async function mostrarPainel(session) {
    telaLogin.hidden = true;
    painel.hidden = false;
    usuarioLogado.textContent = session.user.email;
    await carregarTudo();
    inscreverRealtime();
  }

  // ------------------------------------------------------------------
  // CARREGAMENTO DE DADOS
  // ------------------------------------------------------------------
  async function carregarTudo() {
    await carregarSolicitacoes();
    await carregarCustos();
    atualizarDashboard();
  }

  async function carregarCustos() {
    // Itens vinculados ao catálogo (entram no cálculo de custo)
    const { data: custos } = await supabaseClient
      .from('vw_custos_retirada')
      .select('*')
      .limit(5000);
    custosCache = custos || [];

    // Contagem de itens digitados livremente (fora do catálogo)
    const { count } = await supabaseClient
      .from('solicitacao_itens')
      .select('id', { count: 'exact', head: true })
      .is('catalogo_id', null);
    itensLivresCount = count || 0;

    // IDs de solicitações com pelo menos 1 item repetido pelo mesmo colaborador
    const { data: repData } = await supabaseClient
      .from('vw_solicitacoes_com_repetidos')
      .select('solicitacao_id');
    repetidosSet = new Set((repData || []).map(r => r.solicitacao_id));
  }

  async function carregarSolicitacoes() {
    const { data, error } = await supabaseClient
      .from('solicitacoes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      document.getElementById('tabela-corpo').innerHTML =
        `<tr><td colspan="8" class="tabela-vazia">Erro ao carregar: ${error.message}</td></tr>`;
      return;
    }

    solicitacoesCache = data;
    renderizarTabela();
  }

  // ------------------------------------------------------------------
  // REALTIME (WebSocket do Supabase) — atualiza a lista instantaneamente
  // ------------------------------------------------------------------
  function inscreverRealtime() {
    supabaseClient
      .channel('solicitacoes-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitacoes' }, () => {
        carregarTudo();
      })
      .subscribe();
  }

  // ------------------------------------------------------------------
  // FILTROS
  // ------------------------------------------------------------------
  const filtroBusca = document.getElementById('filtro-busca');
  const filtroTipo = document.getElementById('filtro-tipo');
  const filtroStatus = document.getElementById('filtro-status');
  const filtroCidade = document.getElementById('filtro-cidade');
  const filtroOrdenacao = document.getElementById('filtro-ordenacao');

  [filtroBusca, filtroTipo, filtroStatus, filtroCidade, filtroOrdenacao].forEach(el => {
    el.addEventListener('input', renderizarTabela);
    el.addEventListener('change', renderizarTabela);
  });

  function aplicarFiltros(lista) {
    const busca = filtroBusca.value.trim().toLowerCase();
    const tipo = filtroTipo.value;
    const status = filtroStatus.value;
    const cidade = filtroCidade.value;

    let resultado = lista.filter(s => {
      if (tipo && s.tipo !== tipo) return false;
      if (status && s.status !== status) return false;
      if (cidade && s.cidade !== cidade) return false;
      if (busca) {
        const alvo = `${s.nome_completo} ${s.matricula} ${s.protocolo}`.toLowerCase();
        if (!alvo.includes(busca)) return false;
      }
      return true;
    });

    const [campo, direcao] = filtroOrdenacao.value.split('-');
    resultado.sort((a, b) => {
      let va = a[campo], vb = b[campo];
      if (va < vb) return direcao === 'asc' ? -1 : 1;
      if (va > vb) return direcao === 'asc' ? 1 : -1;
      return 0;
    });

    return resultado;
  }

  // ------------------------------------------------------------------
  // RENDERIZAÇÃO DA TABELA
  // ------------------------------------------------------------------
  function renderizarTabela() {
    const lista = aplicarFiltros(solicitacoesCache);
    const corpo = document.getElementById('tabela-corpo');

    if (lista.length === 0) {
      corpo.innerHTML = '<tr><td colspan="8" class="tabela-vazia">Nenhuma solicitação encontrada.</td></tr>';
      return;
    }

    corpo.innerHTML = lista.map(s => {
      const temRepetido = repetidosSet.has(s.id);
      const estiloLinha = temRepetido ? 'background:#FFFBEA;' : '';
      const badgeRepetido = temRepetido
        ? `<span title="Este colaborador já pediu um ou mais destes itens antes" style="background:#E0A100;color:#fff;border-radius:20px;padding:2px 8px;font-size:10.5px;font-weight:700;margin-left:6px;cursor:help;">⚠ Repetido</span>`
        : '';
      return `
      <tr style="${estiloLinha}">
        <td><strong>${s.protocolo}</strong>${badgeRepetido}</td>
        <td>${new Date(s.created_at).toLocaleString('pt-BR')}</td>
        <td>${escapeHtml(s.nome_completo)}</td>
        <td>${escapeHtml(s.equipe)}</td>
        <td>${escapeHtml(s.cidade)}</td>
        <td>${TIPO_LABEL[s.tipo] || s.tipo}</td>
        <td>
          <select class="select-status" data-id="${s.id}" data-status-atual="${s.status}">
            ${STATUS_ORDEM.map(st => `<option value="${st}" ${st === s.status ? 'selected' : ''}>${STATUS_LABEL[st]}</option>`).join('')}
          </select>
        </td>
        <td><button class="btn-ver-detalhes" data-id="${s.id}">Ver detalhes</button></td>
      </tr>`;
    }).join('');

    corpo.querySelectorAll('.select-status').forEach(sel => {
      sel.addEventListener('change', () => alterarStatus(sel.dataset.id, sel.value));
    });

    corpo.querySelectorAll('.btn-ver-detalhes').forEach(btn => {
      btn.addEventListener('click', () => abrirDetalhes(btn.dataset.id));
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  // ------------------------------------------------------------------
  // ALTERAÇÃO DE STATUS (tempo real para outros usuários via subscribe)
  // ------------------------------------------------------------------
  async function alterarStatus(id, novoStatus) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const { error } = await supabaseClient
      .from('solicitacoes')
      .update({ status: novoStatus, atualizado_por: session?.user?.email || 'desconhecido' })
      .eq('id', id);

    if (error) {
      alert('Erro ao atualizar status: ' + error.message);
      carregarSolicitacoes(); // reverte visualmente
    }
  }

  // ------------------------------------------------------------------
  // MODAL DE DETALHES
  // ------------------------------------------------------------------
  const modal = document.getElementById('modal-detalhes');
  document.getElementById('modal-fechar').addEventListener('click', () => modal.hidden = true);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });

  async function abrirDetalhes(id) {
    const s = solicitacoesCache.find(x => x.id === id);
    if (!s) return;

    const { data: itens } = await supabaseClient.from('solicitacao_itens').select('*').eq('solicitacao_id', id);
    const { data: anexos } = await supabaseClient.from('solicitacao_anexos').select('*').eq('solicitacao_id', id);

    // Detecta itens repetidos pelo mesmo colaborador (histórico completo)
    const { data: repetidos } = await supabaseClient.rpc('detectar_itens_repetidos', { p_solicitacao_id: id });
    const mapRepetidos = {};
    (repetidos || []).forEach(r => {
      mapRepetidos[r.item_nome.toLowerCase().trim()] = r;
    });

    let fotoHtml = '';
    if (anexos && anexos.length > 0) {
      const { data: urlAssinada } = await supabaseClient.storage
        .from('anexos')
        .createSignedUrl(anexos[0].storage_path, 300); // válida por 5 minutos
      if (urlAssinada) {
        fotoHtml = `<img src="${urlAssinada.signedUrl}" class="modal__foto" alt="Foto anexada">`;
      }
    }

    let itensHtml = '';
    if (itens && itens.length > 0) {
      let totalPedido = 0;
      itensHtml = itens.map(i => {
        const custoUnit = parseFloat(i.custo_unitario_snapshot);
        const temCusto = i.catalogo_id && !isNaN(custoUnit);
        const atendido = i.atendido !== false;
        const custoItem = temCusto ? custoUnit * parseFloat(i.quantidade) : 0;
        if (temCusto && atendido) totalPedido += custoItem;

        // Verifica se este item foi pedido antes pelo mesmo colaborador
        const chaveItem = i.item.toLowerCase().trim();
        const infoRepetido = mapRepetidos[chaveItem];
        const alertaRepetido = infoRepetido
          ? `<div style="background:#FFF6E0;border:1px solid #E0A100;border-radius:6px;padding:5px 10px;margin-top:6px;font-size:11.5px;color:#7A5800;">
               ⚠️ <strong>Item já pedido antes</strong> por este colaborador —
               ${infoRepetido.vezes_anterior}x desde o início ·
               último pedido: ${new Date(infoRepetido.ultimo_pedido).toLocaleDateString('pt-BR')} ·
               status: <strong>${STATUS_LABEL[infoRepetido.ultimo_status] || infoRepetido.ultimo_status}</strong>
             </div>`
          : '';

        let custoInfo;
        if (!atendido) {
          custoInfo = `<span style="color:var(--cor-erro);font-weight:700;font-size:11px;"> · SEM ESTOQUE (fora do valor)</span>`;
        } else if (temCusto) {
          custoInfo = `<span style="color:var(--cor-acento);font-weight:700;"> · R$ ${custoItem.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>`;
        } else {
          custoInfo = `<span style="color:#B07C00;font-weight:600;font-size:11px;"> · fora do catálogo</span>`;
        }

        const estiloRiscado = !atendido ? 'text-decoration:line-through;opacity:0.6;' : '';
        const btnToggle = atendido
          ? `<button class="btn-toggle-atendido" data-item-id="${i.id}" data-novo-estado="false" style="background:#FCEBEC;color:var(--cor-erro);border:1px solid var(--cor-erro);border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;margin-top:6px;">Marcar sem estoque</button>`
          : `<button class="btn-toggle-atendido" data-item-id="${i.id}" data-novo-estado="true" style="background:#EAF7F5;color:var(--cor-sucesso);border:1px solid var(--cor-sucesso);border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;margin-top:6px;">Reativar item</button>`;

        return `
        <div class="modal__linha" style="${infoRepetido ? 'background:#FFFBEA;border-radius:8px;' : ''}">
          <strong style="${estiloRiscado}">${infoRepetido ? '⚠️ ' : ''}${escapeHtml(i.item)}</strong>
          <span style="${estiloRiscado}">Qtd: ${i.quantidade} ${i.unidade || ''} ${i.tamanho ? '· Tam: ' + escapeHtml(i.tamanho) : ''}</span>${custoInfo}
          ${i.justificativa ? '<br><em style="' + estiloRiscado + '">' + escapeHtml(i.justificativa) + '</em>' : ''}
          ${alertaRepetido}
          <br>${btnToggle}
        </div>`;
      }).join('');
      if (totalPedido > 0) {
        itensHtml += `<div class="modal__linha" style="background:#EAF7F5;border-radius:8px;"><strong>Custo total do pedido (itens catalogados e atendidos)</strong><span style="font-size:16px;font-weight:800;color:var(--cor-primaria);">R$ ${totalPedido.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span></div>`;
      }
    }

    const dadosEspecificos = Object.entries(s.dados || {})
      .map(([chave, valor]) => `<div class="modal__linha"><strong>${escapeHtml(chave)}</strong>${escapeHtml(String(valor))}</div>`)
      .join('');

    document.getElementById('modal-corpo').innerHTML = `
      <h3>${s.protocolo}</h3>
      <div class="modal__linha"><strong>Nome</strong>${escapeHtml(s.nome_completo)}</div>
      <div class="modal__linha"><strong>Matrícula</strong>${escapeHtml(s.matricula)}</div>
      <div class="modal__linha"><strong>Equipe</strong>${escapeHtml(s.equipe)}</div>
      <div class="modal__linha"><strong>Cidade</strong>${escapeHtml(s.cidade)}</div>
      <div class="modal__linha"><strong>Tipo</strong>${TIPO_LABEL[s.tipo]}</div>
      ${dadosEspecificos}
      ${itensHtml}
      ${s.observacoes ? `<div class="modal__linha"><strong>Observações</strong>${escapeHtml(s.observacoes)}</div>` : ''}
      ${fotoHtml}
    `;

    // Botões "sem estoque" / "reativar" de cada item
    document.querySelectorAll('.btn-toggle-atendido').forEach(btn => {
      btn.addEventListener('click', async () => {
        const novoEstado = btn.dataset.novoEstado === 'true';
        btn.disabled = true;
        btn.textContent = 'Salvando...';
        const { error } = await supabaseClient
          .from('solicitacao_itens')
          .update({ atendido: novoEstado, motivo_nao_atendido: novoEstado ? null : 'sem estoque' })
          .eq('id', btn.dataset.itemId);
        if (error) {
          alert('Erro ao atualizar item: ' + error.message);
          btn.disabled = false;
          return;
        }
        await carregarCustos();
        atualizarDashboard();
        abrirDetalhes(id); // reabre o modal já atualizado
      });
    });

    // Campo de ID externo (visível sempre que o modal abre)
    const divIdExterno = document.getElementById('modal-id-externo');
    const inputIdExterno = document.getElementById('input-id-externo');
    const btnSalvarIdExterno = document.getElementById('btn-salvar-id-externo');
    divIdExterno.hidden = false;
    inputIdExterno.value = s.id_externo || '';

    btnSalvarIdExterno.onclick = async () => {
      const novoId = inputIdExterno.value.trim();
      btnSalvarIdExterno.disabled = true;
      btnSalvarIdExterno.textContent = 'Salvando...';
      const { data: { session } } = await supabaseClient.auth.getSession();
      const { error } = await supabaseClient
        .from('solicitacoes')
        .update({
          id_externo: novoId || null,
          id_externo_registrado_por: session?.user?.email || 'desconhecido',
          id_externo_registrado_em: new Date().toISOString()
        })
        .eq('id', s.id);
      if (error) {
        alert('Erro ao salvar ID: ' + error.message);
      } else {
        btnSalvarIdExterno.textContent = '✔ Salvo!';
        // Atualiza cache local para refletir imediatamente
        const idx = solicitacoesCache.findIndex(x => x.id === s.id);
        if (idx >= 0) solicitacoesCache[idx].id_externo = novoId || null;
        setTimeout(() => { btnSalvarIdExterno.textContent = 'Salvar'; btnSalvarIdExterno.disabled = false; }, 2000);
      }
    };

    modal.hidden = false;
  }

  // ------------------------------------------------------------------
  // DASHBOARD (indicadores + gráficos)
  // ------------------------------------------------------------------
  function atualizarDashboard() {
    const total = solicitacoesCache.length;
    const pendentes = solicitacoesCache.filter(s => !['concluido', 'cancelado'].includes(s.status)).length;
    const concluidas = solicitacoesCache.filter(s => s.status === 'concluido').length;

    const comTempo = solicitacoesCache.filter(s => s.atendido_em);
    const tempoMedio = comTempo.length
      ? (comTempo.reduce((acc, s) => acc + (new Date(s.atendido_em) - new Date(s.created_at)), 0) / comTempo.length / 3600000)
      : 0;

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-pendentes').textContent = pendentes;
    document.getElementById('stat-concluidas').textContent = concluidas;
    document.getElementById('stat-tempo-medio').textContent = tempoMedio.toFixed(1);

    const custoEfetivado = custosCache
      .filter(c => c.efetivado)
      .reduce((acc, c) => acc + (parseFloat(c.custo_total_item) || 0), 0);
    const custoPrevisto = custosCache
      .filter(c => !c.efetivado)
      .reduce((acc, c) => acc + (parseFloat(c.custo_total_item) || 0), 0);

    document.getElementById('stat-custo-total').textContent =
      custoEfetivado.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const elPrevisto = document.getElementById('stat-custo-previsto');
    if (elPrevisto) {
      elPrevisto.textContent =
        custoPrevisto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    document.getElementById('stat-itens-livres').textContent = itensLivresCount;

    renderizarGraficos();
    renderizarGraficosCusto();
  }

  function somarCustoPor(campo) {
    const soma = {};
    custosCache.filter(c => c.efetivado).forEach(c => {
      const chave = c[campo] || '—';
      soma[chave] = (soma[chave] || 0) + (parseFloat(c.custo_total_item) || 0);
    });
    return soma;
  }

  function renderizarGraficosCusto() {
    const paleta = ['#00A896', '#003D67', '#0A5A8F', '#E0A100', '#8E6FCE', '#2E9E6B', '#C6363C', '#6C7A89', '#3E7CB1', '#B85042'];

    const porMaterial = somarCustoPor('item');
    const top10 = Object.fromEntries(
      Object.entries(porMaterial).sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([k, v]) => [k.length > 32 ? k.slice(0, 30) + '…' : k, Math.round(v * 100) / 100])
    );
    graficoCustoMaterial = atualizarGraficoBarraH(graficoCustoMaterial, 'grafico-custo-material', top10, '#00A896');

    const porEquipe = somarCustoPor('equipe');
    const porEquipeArred = Object.fromEntries(Object.entries(porEquipe).map(([k, v]) => [k, Math.round(v * 100) / 100]));
    graficoCustoEquipe = atualizarGraficoBarra(graficoCustoEquipe, 'grafico-custo-equipe', porEquipeArred, ['#003D67']);

    const porCidade = somarCustoPor('cidade');
    const porCidadeArred = Object.fromEntries(Object.entries(porCidade).map(([k, v]) => [k, Math.round(v * 100) / 100]));
    graficoCustoCidade = atualizarGraficoPizza(graficoCustoCidade, 'grafico-custo-cidade', porCidadeArred, paleta.slice(0, 3));
  }

  function atualizarGraficoBarraH(instancia, canvasId, dados, cor) {
    if (instancia) instancia.destroy();
    return new Chart(document.getElementById(canvasId), {
      type: 'bar',
      data: {
        labels: Object.keys(dados),
        datasets: [{ data: Object.values(dados), backgroundColor: cor }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, ticks: { font: { size: 10 } } }, y: { ticks: { font: { size: 10 } } } }
      }
    });
  }

  function contarPor(campo) {
    const contagem = {};
    solicitacoesCache.forEach(s => {
      const chave = campo === 'tipo' ? (TIPO_LABEL[s.tipo] || s.tipo) : s[campo];
      contagem[chave] = (contagem[chave] || 0) + 1;
    });
    return contagem;
  }

  function renderizarGraficos() {
    const paleta = ['#003D67', '#0A5A8F', '#00A896', '#E0A100', '#C6363C', '#8E6FCE', '#6C7A89', '#2E9E6B'];

    const porTipo = contarPor('tipo');
    graficoTipo = atualizarGraficoPizza(graficoTipo, 'grafico-tipo', porTipo, paleta);

    const porCidade = contarPor('cidade');
    graficoCidade = atualizarGraficoPizza(graficoCidade, 'grafico-cidade', porCidade, paleta);

    const porEquipeCompleto = contarPor('equipe');
    const porEquipeTop8 = Object.fromEntries(
      Object.entries(porEquipeCompleto).sort((a, b) => b[1] - a[1]).slice(0, 8)
    );
    graficoEquipe = atualizarGraficoBarra(graficoEquipe, 'grafico-equipe', porEquipeTop8, paleta);
  }

  function atualizarGraficoPizza(instancia, canvasId, dados, paleta) {
    if (instancia) instancia.destroy();
    return new Chart(document.getElementById(canvasId), {
      type: 'doughnut',
      data: {
        labels: Object.keys(dados),
        datasets: [{ data: Object.values(dados), backgroundColor: paleta }]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } } }
    });
  }

  function atualizarGraficoBarra(instancia, canvasId, dados, paleta) {
    if (instancia) instancia.destroy();
    return new Chart(document.getElementById(canvasId), {
      type: 'bar',
      data: {
        labels: Object.keys(dados),
        datasets: [{ data: Object.values(dados), backgroundColor: paleta[0] }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    });
  }

  // ------------------------------------------------------------------
  // INÍCIO
  // ------------------------------------------------------------------
  verificarSessao();

})();
