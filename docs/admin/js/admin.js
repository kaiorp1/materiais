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

  // ------------------------------------------------------------------
  // ALTERAR SENHA (o próprio usuário logado troca a sua)
  // ------------------------------------------------------------------
  const modalSenha = document.getElementById('modal-senha');
  const formAlterarSenha = document.getElementById('form-alterar-senha');
  const inputNovaSenha = document.getElementById('input-nova-senha');
  const inputConfirmarSenha = document.getElementById('input-confirmar-senha');
  const senhaErro = document.getElementById('senha-erro');
  const senhaSucesso = document.getElementById('senha-sucesso');

  document.getElementById('btn-alterar-senha').addEventListener('click', () => {
    formAlterarSenha.reset();
    senhaErro.hidden = true;
    senhaSucesso.hidden = true;
    modalSenha.hidden = false;
  });

  document.getElementById('modal-senha-fechar').addEventListener('click', () => {
    modalSenha.hidden = true;
  });
  modalSenha.addEventListener('click', (e) => { if (e.target === modalSenha) modalSenha.hidden = true; });

  formAlterarSenha.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    senhaErro.hidden = true;
    senhaSucesso.hidden = true;

    const novaSenha = inputNovaSenha.value;
    const confirmarSenha = inputConfirmarSenha.value;

    if (novaSenha.length < 6) {
      senhaErro.textContent = 'A senha precisa ter pelo menos 6 caracteres.';
      senhaErro.hidden = false;
      return;
    }
    if (novaSenha !== confirmarSenha) {
      senhaErro.textContent = 'As senhas digitadas não conferem.';
      senhaErro.hidden = false;
      return;
    }

    const btnSalvar = formAlterarSenha.querySelector('button[type="submit"]');
    btnSalvar.disabled = true;
    btnSalvar.textContent = 'Salvando...';

    // updateUser grava a nova senha direto no Supabase Auth (auth.users) —
    // é a senha real e definitiva da conta, válida a partir de agora.
    const { error } = await supabaseClient.auth.updateUser({ password: novaSenha });

    btnSalvar.disabled = false;
    btnSalvar.textContent = 'Salvar nova senha';

    if (error) {
      senhaErro.textContent = 'Erro ao alterar senha: ' + error.message;
      senhaErro.hidden = false;
      return;
    }

    senhaSucesso.hidden = false;
    formAlterarSenha.reset();
    setTimeout(() => { modalSenha.hidden = true; }, 1500);
  });

  // ------------------------------------------------------------------
  // PAINEL MASTER — regionais, usuários (vínculo) e log de auditoria.
  // Só visível/funcional para quem tem papel = 'master' (RLS garante
  // isso no banco também, isto aqui é só a interface).
  // ------------------------------------------------------------------
  const btnPainelMaster = document.getElementById('btn-painel-master');
  const modalMaster = document.getElementById('modal-master');

  btnPainelMaster.addEventListener('click', () => {
    modalMaster.hidden = false;
    carregarRegionais();
    carregarUsuarios();
    carregarAuditoria();
  });
  document.getElementById('modal-master-fechar').addEventListener('click', () => { modalMaster.hidden = true; });
  modalMaster.addEventListener('click', (e) => { if (e.target === modalMaster) modalMaster.hidden = true; });

  document.querySelectorAll('.tab-master').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-master').forEach(b => {
        b.classList.remove('ativa');
        b.style.borderBottomColor = 'transparent';
        b.style.color = 'var(--cor-texto-suave)';
      });
      btn.classList.add('ativa');
      btn.style.borderBottomColor = 'var(--cor-primaria)';
      btn.style.color = 'inherit';

      document.querySelectorAll('.tab-conteudo-master').forEach(sec => { sec.hidden = true; });
      document.getElementById('tab-conteudo-' + btn.dataset.tab).hidden = false;
    });
  });

  // ---- Sub-aba: Regionais ----
  async function carregarRegionais() {
    const { data, error } = await supabaseClient
      .from('regionais')
      .select('id, nome, slug, ativo')
      .order('nome');

    const corpo = document.getElementById('tabela-regionais-corpo');
    if (error || !data) {
      corpo.innerHTML = '<tr><td colspan="3" style="padding:12px;">Erro ao carregar regionais.</td></tr>';
      return;
    }
    corpo.innerHTML = data.map(r => `
      <tr style="border-bottom:1px solid var(--cor-borda);">
        <td style="padding:8px;">${r.nome}</td>
        <td style="padding:8px;">${r.slug}</td>
        <td style="padding:8px;">${r.ativo ? '✔ Ativa' : '✕ Inativa'}</td>
      </tr>
    `).join('');

    // Também usado para popular o select de regional no form de usuários
    const selectRegional = document.getElementById('input-usuario-regional');
    selectRegional.innerHTML = data.filter(r => r.ativo)
      .map(r => `<option value="${r.id}">${r.nome}</option>`).join('');
  }

  document.getElementById('form-nova-regional').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erroEl = document.getElementById('regional-erro');
    erroEl.hidden = true;

    const nome = document.getElementById('input-regional-nome').value.trim();
    const slug = document.getElementById('input-regional-slug').value.trim().toLowerCase();

    if (!nome || !slug) return;

    const { error } = await supabaseClient.from('regionais').insert({ nome, slug });
    if (error) {
      erroEl.textContent = 'Erro ao criar regional: ' + error.message;
      erroEl.hidden = false;
      return;
    }
    document.getElementById('form-nova-regional').reset();
    await carregarRegionais();
  });

  // ---- Sub-aba: Usuários (vincular regional/papel a um login já criado) ----
  async function carregarUsuarios() {
    const { data, error } = await supabaseClient
      .from('vw_perfis_admin_com_email')
      .select('*')
      .order('nome');

    const corpo = document.getElementById('tabela-usuarios-corpo');
    if (error || !data) {
      corpo.innerHTML = '<tr><td colspan="4" style="padding:12px;">Erro ao carregar usuários.</td></tr>';
      return;
    }
    corpo.innerHTML = data.map(u => `
      <tr style="border-bottom:1px solid var(--cor-borda);">
        <td style="padding:8px;">${u.nome}</td>
        <td style="padding:8px;">${u.email || '—'}</td>
        <td style="padding:8px;">${u.papel}</td>
        <td style="padding:8px;">${u.regional_nome || '—'}</td>
      </tr>
    `).join('');
  }

  document.getElementById('form-novo-usuario').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erroEl = document.getElementById('usuario-erro');
    const sucessoEl = document.getElementById('usuario-sucesso');
    erroEl.hidden = true;
    sucessoEl.hidden = true;

    const nome = document.getElementById('input-usuario-nome').value.trim();
    const uuid = document.getElementById('input-usuario-uuid').value.trim();
    const papel = document.getElementById('input-usuario-papel').value;
    const regionalId = document.getElementById('input-usuario-regional').value;

    if (!nome || !uuid) return;

    const { error } = await supabaseClient.from('perfis_admin').insert({
      id: uuid,
      nome,
      papel,
      regional_id: papel === 'master' ? null : regionalId,
    });

    if (error) {
      erroEl.textContent = 'Erro ao vincular usuário: ' + error.message;
      erroEl.hidden = false;
      return;
    }

    sucessoEl.textContent = '✔ Usuário vinculado com sucesso!';
    sucessoEl.hidden = false;
    document.getElementById('form-novo-usuario').reset();
    await carregarUsuarios();
    setTimeout(() => { sucessoEl.hidden = true; }, 3000);
  });

  // ---- Sub-aba: Log de Auditoria ----
  async function carregarAuditoria() {
    const { data, error } = await supabaseClient
      .from('vw_historico_auditoria')
      .select('*')
      .limit(500);

    const corpo = document.getElementById('tabela-auditoria-corpo');
    if (error || !data) {
      corpo.innerHTML = '<tr><td colspan="5" style="padding:12px;">Erro ao carregar log.</td></tr>';
      return;
    }
    corpo.innerHTML = data.map(h => `
      <tr style="border-bottom:1px solid var(--cor-borda);">
        <td style="padding:8px;">${new Date(h.created_at).toLocaleString('pt-BR')}</td>
        <td style="padding:8px;">${h.protocolo}</td>
        <td style="padding:8px;">${h.regional_nome || '—'}</td>
        <td style="padding:8px;">${STATUS_LABEL[h.status_anterior] || '—'} → ${STATUS_LABEL[h.status_novo] || h.status_novo}</td>
        <td style="padding:8px;">${h.alterado_por || '—'}</td>
      </tr>
    `).join('');
  }

  async function mostrarPainel(session) {
    telaLogin.hidden = true;
    painel.hidden = false;
    usuarioLogado.textContent = session.user.email;
    await configurarFiltroRegional(session);
    await carregarTudo();
    inscreverRealtime();
  }

  // ------------------------------------------------------------------
  // SELETOR DE REGIONAL (só master) + TÍTULO DINÂMICO conforme a
  // regional de quem está logado.
  // ------------------------------------------------------------------
  const tituloPainel = document.getElementById('titulo-painel');

  async function configurarFiltroRegional(session) {
    const { data: perfil } = await supabaseClient
      .from('perfis_admin')
      .select('papel, regional_id, regionais(nome)')
      .eq('id', session.user.id)
      .single();

    if (!perfil || perfil.papel !== 'master') {
      campoFiltroRegional.hidden = true;
      btnPainelMaster.hidden = true;
      tituloPainel.textContent = 'Requisições de Materiais' +
        (perfil && perfil.regionais ? ' · ' + perfil.regionais.nome : '');
      return;
    }

    tituloPainel.textContent = 'Requisições de Materiais · Todas as Regionais';
    btnPainelMaster.hidden = false;

    const { data: regionais } = await supabaseClient
      .from('regionais')
      .select('id, nome')
      .eq('ativo', true)
      .order('nome');

    filtroRegional.innerHTML = '<option value="">Todas (master)</option>' +
      (regionais || []).map(r => `<option value="${r.id}">${r.nome}</option>`).join('');
    campoFiltroRegional.hidden = false;
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
  const filtroRegional = document.getElementById('filtro-regional');
  const campoFiltroRegional = document.getElementById('campo-filtro-regional');
  const filtroOrdenacao = document.getElementById('filtro-ordenacao');
  const filtroDataDe = document.getElementById('filtro-data-de');
  const filtroDataAte = document.getElementById('filtro-data-ate');

  [filtroBusca, filtroTipo, filtroStatus, filtroCidade, filtroRegional, filtroOrdenacao, filtroDataDe, filtroDataAte].forEach(el => {
    el.addEventListener('input', () => { renderizarTabela(); atualizarDashboard(); });
    el.addEventListener('change', () => { renderizarTabela(); atualizarDashboard(); });
  });

  // Botão limpar filtros
  document.getElementById('btn-limpar-filtros').addEventListener('click', () => {
    filtroBusca.value = '';
    filtroTipo.value = '';
    filtroStatus.value = '';
    filtroCidade.value = '';
    filtroRegional.value = '';
    filtroOrdenacao.value = 'created_at-desc';
    filtroDataDe.value = '';
    filtroDataAte.value = '';
    renderizarTabela();
    atualizarDashboard();
  });

  // Botão exportar Excel
  document.getElementById('btn-exportar-excel').addEventListener('click', () => exportarExcel());

  function aplicarFiltros(lista) {
    const busca = filtroBusca.value.trim().toLowerCase();
    const tipo = filtroTipo.value;
    const status = filtroStatus.value;
    const cidade = filtroCidade.value;
    const regional = filtroRegional.value;
    const dataDe = filtroDataDe.value ? new Date(filtroDataDe.value + 'T00:00:00') : null;
    const dataAte = filtroDataAte.value ? new Date(filtroDataAte.value + 'T23:59:59') : null;

    let resultado = lista.filter(s => {
      if (tipo && s.tipo !== tipo) return false;
      if (status && s.status !== status) return false;
      if (cidade && s.cidade !== cidade) return false;
      if (regional && s.regional_id !== regional) return false;
      if (busca) {
        const alvo = `${s.nome_completo} ${s.matricula} ${s.protocolo}`.toLowerCase();
        if (!alvo.includes(busca)) return false;
      }
      if (dataDe && new Date(s.created_at) < dataDe) return false;
      if (dataAte && new Date(s.created_at) > dataAte) return false;
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
  // EXPORTAR EXCEL (SheetJS)
  // Exporta as solicitações filtradas com todos os campos + valor total
  // ------------------------------------------------------------------
  async function exportarExcel() {
    const btn = document.getElementById('btn-exportar-excel');
    btn.textContent = '⏳ Gerando...';
    btn.disabled = true;

    try {
      const lista = aplicarFiltros(solicitacoesCache);

      // Busca itens de todas as solicitações filtradas
      const ids = lista.map(s => s.id);
      let todosItens = [];
      if (ids.length > 0) {
        const { data } = await supabaseClient
          .from('solicitacao_itens')
          .select('solicitacao_id, item, quantidade, unidade, custo_unitario_snapshot, atendido')
          .in('solicitacao_id', ids);
        todosItens = data || [];
      }

      // Monta mapa de custo por solicitação
      const custoMap = {};
      todosItens.forEach(i => {
        if (!custoMap[i.solicitacao_id]) custoMap[i.solicitacao_id] = 0;
        if (i.custo_unitario_snapshot && i.atendido !== false) {
          custoMap[i.solicitacao_id] += parseFloat(i.quantidade) * parseFloat(i.custo_unitario_snapshot);
        }
      });

      // Monta mapa de itens por solicitação (texto)
      const itensMap = {};
      todosItens.forEach(i => {
        if (!itensMap[i.solicitacao_id]) itensMap[i.solicitacao_id] = [];
        itensMap[i.solicitacao_id].push(`${i.item} (${i.quantidade} ${i.unidade || ''})`);
      });

      const TIPO_LABEL_EXP = {
        combustivel: 'Combustível',
        manutencao_veiculo: 'Manutenção de Veículo',
        uniformes_epis: 'Uniformes e EPIs',
        materiais_ferramentas: 'Materiais e Ferramentas',
      };

      const STATUS_LABEL_EXP = {
        recebido: 'Recebido',
        em_analise: 'Em análise',
        separando_material: 'Separando material',
        pronto_retirada: 'Pronto para retirada',
        concluido: 'Concluído',
        cancelado: 'Cancelado',
      };

      // Linha de cabeçalho
      const cabecalho = [
        'Protocolo', 'Data/Hora', 'Nome', 'Matrícula', 'CPF',
        'Equipe', 'Cidade', 'Tipo', 'Status',
        'Itens', 'Valor Total (R$)', 'Concluído em', 'ID Externo', 'Observações'
      ];

      // Linhas de dados
      const linhas = lista.map(s => [
        s.protocolo,
        new Date(s.created_at).toLocaleString('pt-BR'),
        s.nome_completo,
        s.matricula,
        s.cpf || '',
        s.equipe,
        s.cidade,
        TIPO_LABEL_EXP[s.tipo] || s.tipo,
        STATUS_LABEL_EXP[s.status] || s.status,
        (itensMap[s.id] || []).join(' | '),
        custoMap[s.id] ? parseFloat(custoMap[s.id].toFixed(2)) : 0,
        s.atendido_em ? new Date(s.atendido_em).toLocaleString('pt-BR') : '',
        s.id_externo || '',
        s.observacoes || '',
      ]);

      // Cria workbook
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([cabecalho, ...linhas]);

      // Larguras das colunas
      ws['!cols'] = [
        {wch:22},{wch:18},{wch:25},{wch:12},{wch:14},
        {wch:20},{wch:12},{wch:22},{wch:18},
        {wch:50},{wch:14},{wch:18},{wch:14},{wch:30}
      ];

      XLSX.utils.book_append_sheet(wb, ws, 'Solicitações');

      // Nome do arquivo com período se filtrado
      let nomePeriodo = '';
      if (filtroDataDe.value) nomePeriodo += `_de_${filtroDataDe.value}`;
      if (filtroDataAte.value) nomePeriodo += `_ate_${filtroDataAte.value}`;
      const nomeArquivo = `Requisicoes_MetroI${nomePeriodo}_${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.xlsx`;

      XLSX.writeFile(wb, nomeArquivo);
      btn.textContent = '✔ Exportado!';
      setTimeout(() => { btn.textContent = '📥 Exportar Excel'; btn.disabled = false; }, 2500);
    } catch (err) {
      alert('Erro ao exportar: ' + err.message);
      btn.textContent = '📥 Exportar Excel';
      btn.disabled = false;
    }
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

    // ------------------------------------------------------------------
    // COMBUSTÍVEL: calcula KM rodado desde o último abastecimento do MESMO
    // veículo (identificado pela placa — não pelo colaborador, já que o
    // mesmo carro pode ser abastecido por motoristas diferentes).
    // ------------------------------------------------------------------
    let alertaKmHtml = '';
    if (s.tipo === 'combustivel' && s.dados && s.dados.placa) {
      const placaAtual = String(s.dados.placa).trim().toUpperCase();
      const kmAtual = parseFloat(s.dados.km_atual);

      const { data: anteriores } = await supabaseClient
        .from('solicitacoes')
        .select('id, dados, created_at')
        .eq('tipo', 'combustivel')
        .eq('regional_id', s.regional_id)
        .neq('id', s.id)
        .lt('created_at', s.created_at)
        .order('created_at', { ascending: false })
        .limit(20); // pega os últimos 20 abastecimentos da regional e filtra a placa no JS

      const anterior = (anteriores || []).find(a =>
        a.dados && a.dados.placa && String(a.dados.placa).trim().toUpperCase() === placaAtual
      );

      if (!anterior) {
        alertaKmHtml = `<div class="modal__linha" style="background:#EEF3F7;border-radius:8px;font-size:12.5px;">
          ℹ️ Nenhum abastecimento anterior registrado para a placa <strong>${escapeHtml(placaAtual)}</strong>.
        </div>`;
      } else {
        const kmAnterior = parseFloat(anterior.dados.km_atual);
        if (!isNaN(kmAtual) && !isNaN(kmAnterior)) {
          const kmRodado = kmAtual - kmAnterior;
          const dataAnterior = new Date(anterior.created_at).toLocaleDateString('pt-BR');
          if (kmRodado < 0) {
            alertaKmHtml = `<div class="modal__linha" style="background:#FCEBEC;border:1px solid var(--cor-erro);border-radius:8px;font-size:12.5px;">
              ⚠️ <strong>KM informado é menor que o abastecimento anterior</strong> (${kmAnterior.toLocaleString('pt-BR')} km em ${dataAnterior}).
              Verifique se o valor foi digitado corretamente.
            </div>`;
          } else {
            alertaKmHtml = `<div class="modal__linha" style="background:#EAF7F5;border-radius:8px;font-size:12.5px;">
              🚗 <strong>${kmRodado.toLocaleString('pt-BR')} km rodados</strong> desde o último abastecimento
              (${kmAnterior.toLocaleString('pt-BR')} km em ${dataAnterior}).
            </div>`;
          }
        }
      }
    }

    document.getElementById('modal-corpo').innerHTML = `
      <h3>${s.protocolo}</h3>
      <div class="modal__linha"><strong>Nome</strong>${escapeHtml(s.nome_completo)}</div>
      <div class="modal__linha"><strong>Matrícula</strong>${escapeHtml(s.matricula)}</div>
      <div class="modal__linha"><strong>Equipe</strong>${escapeHtml(s.equipe)}</div>
      <div class="modal__linha"><strong>Cidade</strong>${escapeHtml(s.cidade)}</div>
      <div class="modal__linha"><strong>Tipo</strong>${TIPO_LABEL[s.tipo]}</div>
      ${alertaKmHtml}
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
        const { data: { session } } = await supabaseClient.auth.getSession();
        const { error } = await supabaseClient
          .from('solicitacao_itens')
          .update({
            atendido: novoEstado,
            motivo_nao_atendido: novoEstado ? null : 'sem estoque',
            alterado_por: session?.user?.email || 'desconhecido',
            alterado_em: new Date().toISOString()
          })
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
  function solicitacoesPorRegional() {
    const regional = filtroRegional.value;
    return regional ? solicitacoesCache.filter(s => s.regional_id === regional) : solicitacoesCache;
  }

  function custosPorRegional() {
    // custosCache vem de uma view (vw_custos_retirada) que roda sem respeitar
    // o RLS por padrão do Postgres — por isso SEMPRE restringimos aos ids
    // que já vieram corretamente filtrados de solicitacoesCache (essa sim
    // protegida por RLS de verdade), e não só quando o master escolhe uma
    // regional específica no dropdown.
    const regional = filtroRegional.value;
    const listaVisivel = regional
      ? solicitacoesCache.filter(s => s.regional_id === regional)
      : solicitacoesCache;
    const idsVisiveis = new Set(listaVisivel.map(s => s.id));
    return custosCache.filter(c => idsVisiveis.has(c.solicitacao_id));
  }

  function atualizarDashboard() {
    const lista = solicitacoesPorRegional();
    const total = lista.length;
    const pendentes = lista.filter(s => !['concluido', 'cancelado'].includes(s.status)).length;
    const concluidas = lista.filter(s => s.status === 'concluido').length;

    const comTempo = lista.filter(s => s.atendido_em);
    const tempoMedio = comTempo.length
      ? (comTempo.reduce((acc, s) => acc + (new Date(s.atendido_em) - new Date(s.created_at)), 0) / comTempo.length / 3600000)
      : 0;

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-pendentes').textContent = pendentes;
    document.getElementById('stat-concluidas').textContent = concluidas;
    document.getElementById('stat-tempo-medio').textContent = tempoMedio.toFixed(1);

    const custosFiltrados = custosPorRegional();
    const custoEfetivado = custosFiltrados
      .filter(c => c.efetivado)
      .reduce((acc, c) => acc + (parseFloat(c.custo_total_item) || 0), 0);
    const custoPrevisto = custosFiltrados
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
    custosPorRegional().filter(c => c.efetivado).forEach(c => {
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
    solicitacoesPorRegional().forEach(s => {
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
