(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Regional deste deploy — trocar para 'metro2' na pasta/repositório
  // da Metro II. Cada regional tem seu próprio deploy do site com este
  // valor diferente, mas compartilham o mesmo banco Supabase.
  // ------------------------------------------------------------------
  const REGIONAL_SLUG = 'metro2';

  // ------------------------------------------------------------------
  // Estado
  // ------------------------------------------------------------------
  let tipoAtual = null;
  let contadorItens = 0;
  let enviando = false; // trava contra clique duplo / envio duplicado

  // ------------------------------------------------------------------
  // Elementos
  // ------------------------------------------------------------------
  const telaSelecao = document.getElementById('tela-selecao');
  const telaFormulario = document.getElementById('tela-formulario');
  const telaSucesso = document.getElementById('tela-sucesso');

  const formTitulo = document.getElementById('form-titulo');
  const camposEspecificos = document.getElementById('campos-especificos');
  const form = document.getElementById('form-solicitacao');
  const avisoErro = document.getElementById('aviso-erro');
  const btnEnviar = document.getElementById('btn-enviar');
  const btnEnviarTexto = document.getElementById('btn-enviar-texto');
  const btnEnviarSpinner = document.getElementById('btn-enviar-spinner');
  const protocoloGerado = document.getElementById('protocolo-gerado');

  // ------------------------------------------------------------------
  // Navegação entre telas
  // ------------------------------------------------------------------
  function irPara(tela) {
    [telaSelecao, telaFormulario, telaSucesso].forEach(t => t.classList.remove('ativa'));
    tela.classList.add('ativa');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  document.querySelectorAll('.card-tipo').forEach(card => {
    card.addEventListener('click', () => abrirFormulario(card.dataset.tipo));
  });

  document.getElementById('btn-voltar').addEventListener('click', () => {
    resetarFormulario();
    irPara(telaSelecao);
  });

  document.getElementById('btn-nova-solicitacao').addEventListener('click', () => {
    resetarFormulario();
    irPara(telaSelecao);
  });

  // ------------------------------------------------------------------
  // Abrir formulário do tipo selecionado
  // ------------------------------------------------------------------
  function abrirFormulario(tipo) {
    const config = CONFIG_FORMULARIOS[tipo];
    if (!config) return;

    tipoAtual = tipo;
    contadorItens = 0;
    formTitulo.textContent = config.titulo;
    avisoErro.hidden = true;

    // Banner de horário de atendimento
    const estado = estadoHorario();
    const bannerExistente = document.getElementById('banner-horario');
    if (bannerExistente) bannerExistente.remove();
    if (estado !== 'normal') {
      const div = document.createElement('div');
      div.id = 'banner-horario';
      div.innerHTML = bannerHorarioHtml(estado);
      formTitulo.insertAdjacentElement('afterend', div);
    }
    btnEnviar.disabled = (estado === 'fim_de_semana');

    if (config.permiteMultiplosItens) {
      const instrucao = config.instrucaoItens
        ? `<div class="instrucao-itens">${config.instrucaoItens}</div>`
        : '';
      camposEspecificos.innerHTML = `
        <legend>Itens solicitados</legend>
        ${instrucao}
        <div class="lista-itens" id="lista-itens"></div>
        <button type="button" class="btn-add-item" id="btn-add-item">+ Adicionar item</button>
      `;
      adicionarLinhaItem(config);
      document.getElementById('btn-add-item').addEventListener('click', () => adicionarLinhaItem(config));
    } else {
      camposEspecificos.innerHTML = config.renderCamposHtml();
      if (typeof config.afterRender === 'function') config.afterRender(camposEspecificos);
    }

    irPara(telaFormulario);
  }

  function adicionarLinhaItem(config) {
    contadorItens += 1;
    const lista = document.getElementById('lista-itens');
    const div = document.createElement('div');
    div.className = 'item-linha';
    div.dataset.itemIdx = contadorItens;
    div.innerHTML = config.itemCamposHtml(contadorItens);
    lista.appendChild(div);

    div.querySelector('[data-remover-item]').addEventListener('click', () => {
      if (lista.children.length > 1) {
        div.remove();
      }
    });

    if (config.usaCatalogo) {
      ativarAutocompleteCatalogo(div);
    }
  }

  // ------------------------------------------------------------------
  // AUTOCOMPLETE DO CATÁLOGO DE MATERIAIS
  // Busca no banco (função buscar_materiais) enquanto a pessoa digita.
  // - Selecionou da lista => item padronizado (grava catalogo_id, entra no custo)
  // - Digitou livre       => item aceito normalmente, mas fora do cálculo de custo
  // ------------------------------------------------------------------
  function ativarAutocompleteCatalogo(linha) {
    const input = linha.querySelector('[data-autocomplete-catalogo]');
    const hiddenId = linha.querySelector('input[name="catalogo_id"]');
    const listaEl = linha.querySelector('.autocomplete-lista');
    const statusEl = linha.querySelector('[data-status-catalogo]');
    const unidadeInput = linha.querySelector('input[name="unidade"]');
    let timerBusca = null;

    function limparSelecao() {
      hiddenId.value = '';
      if (input.value.trim()) {
        statusEl.textContent = '✎ Item fora do catálogo — não entra no cálculo de custo.';
        statusEl.className = 'campo-ajuda campo-ajuda--livre';
      } else {
        statusEl.textContent = '';
        statusEl.className = 'campo-ajuda';
      }
    }

    function selecionar(mat) {
      input.value = mat.nome;
      hiddenId.value = mat.id;
      if (unidadeInput && mat.unidade) unidadeInput.value = mat.unidade;
      listaEl.hidden = true;
      statusEl.textContent = '✔ Item do catálogo';
      statusEl.className = 'campo-ajuda campo-ajuda--ok';
    }

    input.addEventListener('input', () => {
      limparSelecao();
      const termo = input.value.trim();
      clearTimeout(timerBusca);
      if (termo.length < 3) { listaEl.hidden = true; return; }

      timerBusca = setTimeout(async () => {
        const { data, error } = await supabaseClient.rpc('buscar_materiais', {
          p_termo: termo,
          p_regional_slug: REGIONAL_SLUG
        });
        if (error || !data) { listaEl.hidden = true; return; }

        listaEl.innerHTML = '';
        data.forEach(mat => {
          const item = document.createElement('div');
          item.className = 'autocomplete-lista__item';
          item.innerHTML = `
            <div class="autocomplete-lista__nome">${mat.nome}</div>
            <div class="autocomplete-lista__meta">${mat.unidade || ''} ${mat.codigo ? '· Cód. ' + mat.codigo : ''}</div>
          `;
          item.addEventListener('mousedown', (e) => { e.preventDefault(); selecionar(mat); });
          listaEl.appendChild(item);
        });

        const livre = document.createElement('div');
        livre.className = 'autocomplete-lista__livre';
        livre.textContent = data.length === 0
          ? 'Nenhum item encontrado — o texto digitado será usado como descrição livre.'
          : 'Não achou? Continue digitando a descrição livremente.';
        livre.addEventListener('mousedown', (e) => { e.preventDefault(); listaEl.hidden = true; });
        listaEl.appendChild(livre);

        listaEl.hidden = false;
      }, 300);
    });

    input.addEventListener('blur', () => {
      setTimeout(() => { listaEl.hidden = true; }, 150);
    });
  }

  function resetarFormulario() {
    form.reset();
    camposEspecificos.innerHTML = '';
    avisoErro.hidden = true;
    tipoAtual = null;
  }

  // ------------------------------------------------------------------
  // JANELA DE ATENDIMENTO
  // Seg-Sex 08:00–15:30 (horário de Brasília):
  //  - dentro  => normal
  //  - fora    => envia, mas avisa que será atendido no próximo dia útil
  //  - sáb/dom => bloqueado
  // ------------------------------------------------------------------
  function estadoHorario() {
    const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const dia = agora.getDay(); // 0=dom, 6=sáb
    if (dia === 0 || dia === 6) return 'fim_de_semana';
    const minutos = agora.getHours() * 60 + agora.getMinutes();
    if (minutos >= 8 * 60 && minutos <= 15 * 60 + 30) return 'normal';
    return 'fora_horario';
  }

  function bannerHorarioHtml(estado) {
    if (estado === 'fora_horario') {
      return '<div class="banner-horario banner-horario--aviso">⏰ Fora do horário de atendimento (seg–sex, 08h às 15h30). Você pode enviar normalmente, mas a solicitação <strong>será atendida no próximo dia útil</strong>.</div>';
    }
    if (estado === 'fim_de_semana') {
      return '<div class="banner-horario banner-horario--bloqueio">🚫 As solicitações ficam disponíveis apenas de <strong>segunda a sexta</strong>. Volte no próximo dia útil.</div>';
    }
    return '';
  }

  // ------------------------------------------------------------------
  // Detector de "lista disfarçada": texto livre que aparenta conter
  // VÁRIOS materiais num campo só (ex: "2 luvas de redução e 1 tarraxa
  // de 40mm, e 1 tarraxa de 2 polegadas..."). Aplicado apenas a itens
  // NÃO selecionados do catálogo.
  // ------------------------------------------------------------------
  function pareceListaDeMateriais(texto) {
    const t = ' ' + texto.toLowerCase().trim() + ' ';

    // Conectivos seguidos de quantidade: " e 1 ", " e 2 ", ", 3 ", "; 2 "
    if (/[,;]\s*\d+\s/.test(t)) return true;
    if (/\se\s+\d+\s/.test(t)) return true;
    if (/\s\+\s*\d+/.test(t)) return true;

    // Vírgula/ponto-e-vírgula seguido de PALAVRA (ex: "cabo 800mm, joelho 45")
    // Números decimais tipo "46,35CM" não têm espaço após a vírgula, então não disparam.
    if (/[,;]\s+[a-zà-ú]/.test(t)) return true;

    // Mais de um número de quantidade no início de trechos ("2 luvas ... 1 tarraxa")
    const qtdInicioTrechos = (t.match(/(?:^|\s)(\d+)\s+[a-zà-ú]/g) || []).length;
    if (qtdInicioTrechos >= 2) return true;

    // Texto muito longo para um único material digitado livremente
    if (texto.length > 90) return true;

    return false;
  }

  // ------------------------------------------------------------------
  // Sanitização simples de texto (remove tags HTML de inputs de texto)
  // ------------------------------------------------------------------
  function sanitizar(valor) {
    if (typeof valor !== 'string') return valor;
    return valor.replace(/<[^>]*>/g, '').trim();
  }

  // ------------------------------------------------------------------
  // Coleta os dados comuns do formulário
  // ------------------------------------------------------------------
  function coletarDadosComuns(formData) {
    return {
      nome_completo: sanitizar(formData.get('nome_completo')),
      matricula: sanitizar(formData.get('matricula')),
      cpf: sanitizar(formData.get('cpf') || '').replace(/\D/g, ''), // só dígitos
      equipe: sanitizar(formData.get('equipe')),
      cidade: formData.get('cidade'),
      observacoes: sanitizar(formData.get('observacoes') || '') || null
    };
  }

  // ------------------------------------------------------------------
  // Upload de foto para o Storage do Supabase (bucket "anexos")
  // Limite de 5MB é reforçado aqui e também no bucket (backend).
  // ------------------------------------------------------------------
  const TAMANHO_MAX_FOTO = 5 * 1024 * 1024; // 5MB

  async function uploadFoto(arquivo, solicitacaoId) {
    if (!arquivo) return null;

    if (arquivo.size > TAMANHO_MAX_FOTO) {
      throw new Error('A imagem selecionada é maior que 5MB. Escolha uma foto menor.');
    }
    if (!arquivo.type.startsWith('image/')) {
      throw new Error('O arquivo enviado precisa ser uma imagem.');
    }

    const extensao = arquivo.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const caminho = `${solicitacaoId}/${Date.now()}.${extensao}`;

    const { error } = await supabaseClient.storage
      .from('anexos')
      .upload(caminho, arquivo, { cacheControl: '3600', upsert: false });

    if (error) throw new Error('Falha ao enviar a foto: ' + error.message);

    return caminho;
  }

  // ------------------------------------------------------------------
  // Envio do formulário
  // ------------------------------------------------------------------
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();

    if (enviando) return; // proteção contra envio duplicado (duplo clique / duplo submit)
    if (!tipoAtual) return;

    // Janela de atendimento: fim de semana bloqueia; fora do horário registra flag
    const estadoJanela = estadoHorario();
    if (estadoJanela === 'fim_de_semana') {
      mostrarErro('Solicitações só podem ser enviadas de segunda a sexta. Volte no próximo dia útil.');
      return;
    }

    avisoErro.hidden = true;

    const formData = new FormData(form);
    const config = CONFIG_FORMULARIOS[tipoAtual];
    const dadosComuns = coletarDadosComuns(formData);

    // Validação básica extra (além do "required" nativo do HTML5)
    if (!dadosComuns.nome_completo || !dadosComuns.matricula || !dadosComuns.equipe || !dadosComuns.cidade) {
      mostrarErro('Preencha todos os campos obrigatórios.');
      return;
    }

    setEnviando(true);

    try {
      let dadosEspecificos = {};
      let itens = [];
      let arquivoFoto = null;

      if (config.permiteMultiplosItens) {
        const linhas = document.querySelectorAll('#lista-itens .item-linha');
        if (linhas.length === 0) throw new Error('Adicione pelo menos um item.');

        linhas.forEach(linha => {
          const item = sanitizar(linha.querySelector('[name="item"]').value);
          const quantidade = parseFloat(linha.querySelector('[name="quantidade"]').value);
          if (!item || !quantidade || quantidade <= 0) {
            throw new Error('Verifique os itens: nome e quantidade são obrigatórios.');
          }
          const catalogoEl = linha.querySelector('input[name="catalogo_id"]');
          const doCatalogo = !!(catalogoEl && catalogoEl.value);

          // Bloqueio de "lista disfarçada": vários materiais num campo só.
          // Só se aplica a texto livre — itens selecionados do catálogo passam direto.
          if (!doCatalogo && pareceListaDeMateriais(item)) {
            throw new Error('O campo "' + item.slice(0, 40) + '..." parece conter VÁRIOS materiais. Coloque apenas UM material por linha e use o botão "+ Adicionar item" para os demais.');
          }
          const tamanhoEl = linha.querySelector('[name="tamanho"]');
          const unidadeEl = linha.querySelector('[name="unidade"]');
          const justificativaEl = linha.querySelector('[name="justificativa"]');

          itens.push({
            item,
            quantidade,
            tamanho: tamanhoEl ? sanitizar(tamanhoEl.value) || null : null,
            unidade: unidadeEl ? sanitizar(unidadeEl.value) || null : null,
            justificativa: justificativaEl ? sanitizar(justificativaEl.value) || null : null,
            catalogo_id: doCatalogo ? catalogoEl.value : null
          });
        });
      } else {
        // Campos específicos "soltos" (combustível / manutenção)
        camposEspecificos.querySelectorAll('input, select, textarea').forEach(el => {
          if (el.type === 'file') {
            arquivoFoto = el.files[0] || null;
          } else if (el.name) {
            dadosEspecificos[el.name] = sanitizar(el.value);
          }
        });

        if (tipoAtual === 'combustivel' && !arquivoFoto) {
          throw new Error('A foto do painel com a quilometragem é obrigatória.');
        }
        if (tipoAtual === 'manutencao_veiculo' && !dadosEspecificos.urgencia) {
          throw new Error('Selecione o nível de urgência.');
        }
      }

      // 1. Insere a solicitação principal via função RPC (registrar_solicitacao).
      //    Não usamos .from('solicitacoes').insert().select() diretamente porque
      //    o colaborador (anon) só tem permissão de INSERT, não de SELECT — e o
      //    Supabase precisa "ler de volta" a linha para devolver o protocolo
      //    gerado. A função RPC roda com privilégio elevado só para esse retorno.
      const { data: resultadoRpc, error: erroInsercao } = await supabaseClient.rpc('registrar_solicitacao', {
        p_regional_slug: REGIONAL_SLUG,
        p_nome_completo: dadosComuns.nome_completo,
        p_matricula: dadosComuns.matricula,
        p_cpf: dadosComuns.cpf || null,
        p_equipe: dadosComuns.equipe,
        p_cidade: dadosComuns.cidade,
        p_tipo: tipoAtual,
        p_dados: (estadoJanela === 'fora_horario') ? { ...dadosEspecificos, fora_horario: true } : dadosEspecificos,
        p_observacoes: dadosComuns.observacoes
      });

      if (erroInsercao) throw new Error('Erro ao enviar solicitação: ' + erroInsercao.message);

      const solicitacao = resultadoRpc[0];

      // 2. Upload de foto, se houver, e atualiza o registro com o caminho
      if (arquivoFoto) {
        const caminhoFoto = await uploadFoto(arquivoFoto, solicitacao.id);
        await supabaseClient.from('solicitacao_anexos').insert({
          solicitacao_id: solicitacao.id,
          storage_path: caminhoFoto,
          tipo_anexo: 'foto'
        });
      }

      // 3. Insere itens múltiplos, se houver
      if (itens.length > 0) {
        const itensParaInserir = itens.map(i => ({ ...i, solicitacao_id: solicitacao.id }));
        const { error: erroItens } = await supabaseClient.from('solicitacao_itens').insert(itensParaInserir);
        if (erroItens) throw new Error('Erro ao salvar itens: ' + erroItens.message);
      }

      // Guarda protocolo localmente para "Minhas solicitações"
      salvarProtocoloLocal(solicitacao.protocolo, dadosComuns.matricula);

      protocoloGerado.textContent = solicitacao.protocolo;
      resetarFormulario();
      irPara(telaSucesso);

    } catch (err) {
      mostrarErro(err.message || 'Ocorreu um erro inesperado. Tente novamente.');
    } finally {
      setEnviando(false);
    }
  });

  function mostrarErro(msg) {
    avisoErro.textContent = '⚠️ ' + msg;
    avisoErro.hidden = false;
    avisoErro.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function setEnviando(estado) {
    enviando = estado;
    btnEnviar.disabled = estado;
    btnEnviarTexto.hidden = estado;
    btnEnviarSpinner.hidden = !estado;
  }

  // ------------------------------------------------------------------
  // Histórico local simples (para a tela "Minhas solicitações")
  // ------------------------------------------------------------------
  function salvarProtocoloLocal(protocolo, matricula) {
    try {
      const chave = 'meus_protocolos';
      const lista = JSON.parse(localStorage.getItem(chave) || '[]');
      lista.unshift({ protocolo, matricula, data: new Date().toISOString() });
      localStorage.setItem(chave, JSON.stringify(lista.slice(0, 20)));
    } catch (e) { /* localStorage indisponível: ignora silenciosamente */ }
  }

})();
