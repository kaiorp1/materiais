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
  let graficoTipo, graficoCidade, graficoEquipe;

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
    atualizarDashboard();
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

    corpo.innerHTML = lista.map(s => `
      <tr>
        <td><strong>${s.protocolo}</strong></td>
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
      </tr>
    `).join('');

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
      itensHtml = itens.map(i => `
        <div class="modal__linha">
          <strong>${escapeHtml(i.item)}</strong>
          Qtd: ${i.quantidade} ${i.unidade || ''} ${i.tamanho ? '· Tam: ' + escapeHtml(i.tamanho) : ''}
          ${i.justificativa ? '<br><em>' + escapeHtml(i.justificativa) + '</em>' : ''}
        </div>
      `).join('');
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

    renderizarGraficos();
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
