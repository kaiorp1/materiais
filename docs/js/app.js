(function () {
  'use strict';

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

    if (config.permiteMultiplosItens) {
      camposEspecificos.innerHTML = `
        <legend>Itens solicitados</legend>
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
  }

  function resetarFormulario() {
    form.reset();
    camposEspecificos.innerHTML = '';
    avisoErro.hidden = true;
    tipoAtual = null;
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
          const tamanhoEl = linha.querySelector('[name="tamanho"]');
          const unidadeEl = linha.querySelector('[name="unidade"]');
          const justificativaEl = linha.querySelector('[name="justificativa"]');

          itens.push({
            item,
            quantidade,
            tamanho: tamanhoEl ? sanitizar(tamanhoEl.value) || null : null,
            unidade: unidadeEl ? sanitizar(unidadeEl.value) || null : null,
            justificativa: justificativaEl ? sanitizar(justificativaEl.value) || null : null
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
        p_nome_completo: dadosComuns.nome_completo,
        p_matricula: dadosComuns.matricula,
        p_equipe: dadosComuns.equipe,
        p_cidade: dadosComuns.cidade,
        p_tipo: tipoAtual,
        p_dados: dadosEspecificos,
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
