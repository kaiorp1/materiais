/**
 * Definição dos formulários específicos por tipo de solicitação.
 * Para adicionar um novo tipo de solicitação no futuro, basta:
 *   1. Adicionar o valor no ENUM tipo_solicitacao no banco (database/schema.sql)
 *   2. Adicionar um card em index.html (cards-grid)
 *   3. Adicionar uma entrada aqui em CONFIG_FORMULARIOS
 * Nenhuma outra alteração de código é necessária.
 */

const CONFIG_FORMULARIOS = {
  combustivel: {
    titulo: 'Combustível',
    permiteMultiplosItens: false,
    renderCamposHtml: () => `
      <legend>Dados do abastecimento</legend>
      <div class="linha-2col">
        <label class="campo">
          <span>Veículo *</span>
          <input type="text" name="veiculo" required placeholder="Ex: Caminhão Pipa 03">
        </label>
        <label class="campo">
          <span>Placa *</span>
          <input type="text" name="placa" required maxlength="8" style="text-transform:uppercase" placeholder="ABC1D23">
        </label>
      </div>
      <label class="campo">
        <span>KM atual *</span>
        <input type="number" name="km_atual" required min="0" inputmode="numeric" placeholder="Ex: 85320">
      </label>
      <label class="campo">
        <span>Foto do painel (quilometragem) *</span>
        <input type="file" name="foto" accept="image/*" capture="environment" required>
        <span class="campo-ajuda">A foto serve apenas para controle interno.</span>
      </label>
    `
  },

  manutencao_veiculo: {
    titulo: 'Manutenção de Veículo',
    permiteMultiplosItens: false,
    renderCamposHtml: () => `
      <legend>Dados do veículo e problema</legend>
      <div class="linha-2col">
        <label class="campo">
          <span>Veículo *</span>
          <input type="text" name="veiculo" required placeholder="Ex: Van 12">
        </label>
        <label class="campo">
          <span>Placa *</span>
          <input type="text" name="placa" required maxlength="8" style="text-transform:uppercase" placeholder="ABC1D23">
        </label>
      </div>
      <label class="campo">
        <span>Descrição detalhada do problema *</span>
        <textarea name="descricao_problema" rows="4" required placeholder="Descreva o problema com o máximo de detalhes"></textarea>
      </label>
      <label class="campo">
        <span>Urgência *</span>
        <div class="chips-urgencia" id="chips-urgencia">
          <button type="button" class="chip-urgencia" data-nivel="baixa">Baixa</button>
          <button type="button" class="chip-urgencia" data-nivel="media">Média</button>
          <button type="button" class="chip-urgencia" data-nivel="alta">Alta</button>
        </div>
        <input type="hidden" name="urgencia" required>
      </label>
      <label class="campo">
        <span>Foto (opcional)</span>
        <input type="file" name="foto" accept="image/*" capture="environment">
      </label>
    `,
    afterRender: (container) => {
      const chips = container.querySelectorAll('.chip-urgencia');
      const hidden = container.querySelector('input[name="urgencia"]');
      chips.forEach(chip => {
        chip.addEventListener('click', () => {
          chips.forEach(c => c.removeAttribute('data-selecionado'));
          chip.setAttribute('data-selecionado', 'true');
          hidden.value = chip.dataset.nivel;
        });
      });
    }
  },

  uniformes_epis: {
    titulo: 'Uniformes e EPIs',
    permiteMultiplosItens: true,
    usaCatalogo: true,
    instrucaoItens: '🛈 Adicione <strong>UM item por linha</strong> e selecione da lista de sugestões. Para mais itens, use o botão <strong>+ Adicionar item</strong>.',
    itemCamposHtml: (idx) => `
      <button type="button" class="item-linha__remover" data-remover-item>&times;</button>
      <label class="campo campo-autocomplete">
        <span>Item * <em style="font-weight:400;color:var(--cor-texto-suave);">(apenas 1 por linha)</em></span>
        <input type="text" name="item" required maxlength="120" placeholder="Digite para buscar no catálogo..." autocomplete="off" data-autocomplete-catalogo>
        <input type="hidden" name="catalogo_id">
        <div class="autocomplete-lista" hidden></div>
        <span class="campo-ajuda" data-status-catalogo></span>
      </label>
      <div class="linha-2col">
        <label class="campo">
          <span>Tamanho</span>
          <input type="text" name="tamanho" placeholder="Ex: G ou nº 42">
        </label>
        <label class="campo">
          <span>Quantidade *</span>
          <input type="number" name="quantidade" required min="1" step="1" value="1">
        </label>
      </div>
      <label class="campo">
        <span>Justificativa *</span>
        <input type="text" name="justificativa" required placeholder="Ex: Uniforme danificado / novo colaborador">
      </label>
    `
  },

  materiais_ferramentas: {
    titulo: 'Materiais e Ferramentas',
    permiteMultiplosItens: true,
    usaCatalogo: true, // ativa autocomplete do catálogo de materiais
    instrucaoItens: '🛈 Adicione <strong>UM material por linha</strong> e selecione da lista de sugestões. Para pedir mais materiais, use o botão <strong>+ Adicionar item</strong>.',
    itemCamposHtml: (idx) => `
      <button type="button" class="item-linha__remover" data-remover-item>&times;</button>
      <label class="campo campo-autocomplete">
        <span>Material / Ferramenta * <em style="font-weight:400;color:var(--cor-texto-suave);">(apenas 1 por linha)</em></span>
        <input type="text" name="item" required maxlength="120" placeholder="Digite para buscar no catálogo..." autocomplete="off" data-autocomplete-catalogo>
        <input type="hidden" name="catalogo_id">
        <div class="autocomplete-lista" hidden></div>
        <span class="campo-ajuda" data-status-catalogo></span>
      </label>
      <div class="linha-2col">
        <label class="campo">
          <span>Quantidade *</span>
          <input type="number" name="quantidade" required min="1" step="1" value="1">
        </label>
        <label class="campo">
          <span>Unidade</span>
          <input type="text" name="unidade" placeholder="Ex: un, metro, caixa">
        </label>
      </div>
    `
  }
};
