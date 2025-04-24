const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const moment = require('moment');

// Configuração do cliente com opções otimizadas para ambiente de servidor
const puppeteerOptions = {
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--single-process',
    '--disable-gpu'
  ],
  headless: true
};

// Configuração do cliente
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './whatsapp-session' // Caminho para armazenar dados de sessão
  }),
  puppeteer: puppeteerOptions
});

// Estruturas de dados
let gastos = [];
let categorias = {
  'alimentação': ['comida', 'restaurante', 'lanche', 'mercado', 'supermercado', 'feira', 'delivery'],
  'transporte': ['uber', 'táxi', '99', 'gasolina', 'combustível', 'estacionamento', 'metrô', 'ônibus', 'passagem'],
  'moradia': ['aluguel', 'condomínio', 'água', 'luz', 'energia', 'gás', 'internet', 'iptu'],
  'lazer': ['cinema', 'teatro', 'show', 'viagem', 'passeio', 'streaming', 'netflix', 'spotify'],
  'saúde': ['remédio', 'farmácia', 'médico', 'consulta', 'exame', 'academia', 'dentista'],
  'educação': ['curso', 'livro', 'faculdade', 'escola', 'material', 'mensalidade'],
  'compras': ['roupa', 'sapato', 'eletrônico', 'celular', 'presente', 'shopping'],
  'outros': []
};

let orcamentos = {};
let chatProprio = null; // Armazena o ID do chat próprio

// Lista de contatos permitidos (números de telefone com código do país)
const contatosPermitidos = [];

// Diretório para salvar imagens de comprovantes
const diretorioComprovantes = path.join(__dirname, 'comprovantes');
if (!fs.existsSync(diretorioComprovantes)) {
  fs.mkdirSync(diretorioComprovantes, { recursive: true });
}

// Função para garantir que os arquivos de dados existam
function inicializarArquivos() {
  const arquivos = {
    'gastos.json': [],
    'categorias.json': categorias,
    'orcamentos.json': {},
    'contatos_permitidos.json': []
  };

  for (const [arquivo, valorPadrao] of Object.entries(arquivos)) {
    if (!fs.existsSync(arquivo)) {
      fs.writeFileSync(arquivo, JSON.stringify(valorPadrao, null, 2));
      console.log(`Arquivo ${arquivo} criado com valores padrão`);
    }
  }
}

// Inicializar arquivos
inicializarArquivos();

// Carregar dados se já existirem
try {
  if (fs.existsSync('gastos.json')) {
    gastos = JSON.parse(fs.readFileSync('gastos.json'));
    console.log(`✅ ${gastos.length} gastos carregados`);
  }

  if (fs.existsSync('categorias.json')) {
    categorias = JSON.parse(fs.readFileSync('categorias.json'));
    console.log('✅ Categorias carregadas');
  }

  if (fs.existsSync('orcamentos.json')) {
    orcamentos = JSON.parse(fs.readFileSync('orcamentos.json'));
    console.log('✅ Orçamentos carregados');
  }

  if (fs.existsSync('chat_proprio.json')) {
    chatProprio = JSON.parse(fs.readFileSync('chat_proprio.json')).chatId;
    console.log('✅ Chat próprio carregado:', chatProprio);
  }

  if (fs.existsSync('contatos_permitidos.json')) {
    const contatosCarregados = JSON.parse(fs.readFileSync('contatos_permitidos.json'));
    contatosPermitidos.push(...contatosCarregados);
    console.log('✅ Lista de contatos permitidos carregada:', contatosPermitidos);
  }
} catch (error) {
  console.error('❌ Erro ao carregar dados:', error);
}

/* === QR code === */
client.on('qr', (qr) => {
  // Gerar QR code no terminal
  qrcode.generate(qr, { small: true });
  console.log('QR CODE STRING:', qr);
  
  // Também registrar o QR code no console para poder visualizar nos logs do servidor
  console.log('QR CODE GERADO. Escaneie com seu WhatsApp:');
  console.log(qr);
});

/* === Pronto === */
client.on('ready', () => {
  console.log('✅ Bot está pronto!');
});

/* === Reconexão === */
client.on('disconnected', (reason) => {
  console.log('Bot desconectado:', reason);
  console.log('Tentando reconectar...');
  client.initialize();
});

/* === Funções Auxiliares === */

// Função para categorizar automaticamente um gasto
function categorizarGasto(descricao) {
  descricao = descricao.toLowerCase();
  
  for (const [categoria, palavrasChave] of Object.entries(categorias)) {
    for (const palavra of palavrasChave) {
      if (descricao.includes(palavra.toLowerCase())) {
        return categoria;
      }
    }
  }
  
  return 'outros';
}

// Função para formatar data
function formatarData(dataISO) {
  return moment(dataISO).format('DD/MM/YYYY');
}

// Função para calcular gastos por categoria
function gastosPorCategoria() {
  const resultado = {};
  
  gastos.forEach(gasto => {
    const categoria = gasto.categoria;
    if (!resultado[categoria]) {
      resultado[categoria] = 0;
    }
    resultado[categoria] += gasto.valor;
  });
  
  return resultado;
}

// Função para calcular gastos por período
function gastosPorPeriodo(periodo) {
  const hoje = moment();
  const dataInicio = periodo === 'mes' ? 
    moment().startOf('month') : 
    periodo === 'semana' ? 
      moment().startOf('week') : 
      periodo === 'ano' ? 
        moment().startOf('year') : 
        moment().subtract(1, 'days');
  
  return gastos.filter(gasto => {
    const dataGasto = moment(gasto.data);
    return dataGasto.isSameOrAfter(dataInicio) && dataGasto.isSameOrBefore(hoje);
  });
}

// Função para verificar se um orçamento foi excedido
function verificarOrcamentos() {
  const gastosDoMes = gastosPorPeriodo('mes');
  const totalPorCategoria = {};
  
  gastosDoMes.forEach(gasto => {
    if (!totalPorCategoria[gasto.categoria]) {
      totalPorCategoria[gasto.categoria] = 0;
    }
    totalPorCategoria[gasto.categoria] += gasto.valor;
  });
  
  const alertas = [];
  
  for (const [categoria, limite] of Object.entries(orcamentos)) {
    const gasto = totalPorCategoria[categoria] || 0;
    const percentual = (gasto / limite) * 100;
    
    if (percentual >= 90 && percentual < 100) {
      alertas.push(`⚠️ Você já usou ${percentual.toFixed(0)}% do orçamento de ${categoria} (R$${gasto.toFixed(2)} de R$${limite.toFixed(2)})`);
    } else if (percentual >= 100) {
      alertas.push(`🚨 ALERTA: Orçamento de ${categoria} EXCEDIDO! (R$${gasto.toFixed(2)} de R$${limite.toFixed(2)})`);
    }
  }
  
  return alertas;
}

// Função para gerar insights sobre gastos
function gerarInsights() {
  const insights = [];
  
  // Verifica se há gastos suficientes para análise
  if (gastos.length < 5) {
    return ['Registre mais gastos para receber insights personalizados.'];
  }
  
  // Categoria com maior gasto no mês
  const gastosDoMes = gastosPorPeriodo('mes');
  const totalPorCategoria = {};
  
  gastosDoMes.forEach(gasto => {
    if (!totalPorCategoria[gasto.categoria]) {
      totalPorCategoria[gasto.categoria] = 0;
    }
    totalPorCategoria[gasto.categoria] += gasto.valor;
  });
  
  let maiorCategoria = '';
  let maiorValor = 0;
  
  for (const [categoria, valor] of Object.entries(totalPorCategoria)) {
    if (valor > maiorValor) {
      maiorValor = valor;
      maiorCategoria = categoria;
    }
  }
  
  if (maiorCategoria) {
    insights.push(`📊 Seu maior gasto este mês foi com ${maiorCategoria}: R$${maiorValor.toFixed(2)}`);
  }
  
  // Comparação com mês anterior
  const mesAtual = moment().month();
  const mesAnterior = moment().subtract(1, 'month').month();
  
  const gastosAtual = gastos.filter(g => moment(g.data).month() === mesAtual);
  const gastosAnterior = gastos.filter(g => moment(g.data).month() === mesAnterior);
  
  const totalAtual = gastosAtual.reduce((soma, g) => soma + g.valor, 0);
  const totalAnterior = gastosAnterior.reduce((soma, g) => soma + g.valor, 0);
  
  if (gastosAnterior.length > 0) {
    const diferenca = totalAtual - totalAnterior;
    const percentual = (Math.abs(diferenca) / totalAnterior) * 100;
    
    if (diferenca > 0) {
      insights.push(`📈 Seus gastos aumentaram ${percentual.toFixed(0)}% em relação ao mês anterior.`);
    } else if (diferenca < 0) {
      insights.push(`📉 Seus gastos diminuíram ${percentual.toFixed(0)}% em relação ao mês anterior. Parabéns!`);
    } else {
      insights.push(`🔄 Seus gastos estão estáveis em relação ao mês anterior.`);
    }
  }
  
  return insights;
}

// Função para salvar dados
function salvarDados(tipo, dados) {
  try {
    fs.writeFileSync(`${tipo}.json`, JSON.stringify(dados, null, 2));
    console.log(`✅ Dados de ${tipo} salvos com sucesso`);
    return true;
  } catch (error) {
    console.error(`❌ Erro ao salvar dados de ${tipo}:`, error);
    return false;
  }
}

/* === Mensagens === */
client.on('message_create', async (msg) => {
  try {
    // Verifica se é a primeira mensagem do próprio usuário e configura o chat próprio
    if (msg.fromMe && !chatProprio) {
      chatProprio = msg.from;
      salvarDados('chat_proprio', { chatId: chatProprio });
      console.log('✅ Chat próprio configurado:', chatProprio);
      await msg.reply(`✅ Este chat foi configurado como seu chat principal com o bot. Agora o bot só responderá às suas mensagens neste chat.`);
      return;
    }
    
    // Verifica se a mensagem é do próprio usuário no chat próprio ou de um contato permitido
    const remetente = msg.from; // Número do remetente no formato 'XXXXXXXXXXX@c.us'
    const numeroRemetente = remetente ? remetente.split('@')[0] : '';
    
    // Ignora mensagens do próprio usuário em outros chats
    if (msg.fromMe && chatProprio && remetente !== chatProprio) {
      console.log(`Mensagem ignorada do próprio usuário em outro chat: ${remetente}`);
      return;
    }
    
    // Ignora mensagens de contatos não permitidos
    if (!msg.fromMe && !contatosPermitidos.includes(numeroRemetente)) {
      console.log(`Mensagem ignorada de ${numeroRemetente} (não está na lista de permitidos)`);
      return;
    }

    const texto = msg.body.toLowerCase();
    console.log('Recebido:', texto, 'de:', msg.fromMe ? 'mim mesmo' : numeroRemetente);    // debug

    /* --- Comandos de administração --- */
    // Adicionar contato à lista de permitidos (apenas o próprio usuário pode fazer isso)
    if (msg.fromMe && texto.startsWith('permitir ')) {
      const numeroParaAdicionar = texto.replace('permitir ', '').trim();
      if (numeroParaAdicionar && !contatosPermitidos.includes(numeroParaAdicionar)) {
        contatosPermitidos.push(numeroParaAdicionar);
        salvarDados('contatos_permitidos', contatosPermitidos);
        await msg.reply(`✅ Contato ${numeroParaAdicionar} adicionado à lista de permitidos.`);
      } else {
        await msg.reply(`⚠️ Contato já está na lista ou número inválido.`);
      }
      return;
    }

    // Remover contato da lista de permitidos (apenas o próprio usuário pode fazer isso)
    if (msg.fromMe && texto.startsWith('remover ')) {
      const numeroParaRemover = texto.replace('remover ', '').trim();
      const index = contatosPermitidos.indexOf(numeroParaRemover);
      if (index > -1) {
        contatosPermitidos.splice(index, 1);
        salvarDados('contatos_permitidos', contatosPermitidos);
        await msg.reply(`✅ Contato ${numeroParaRemover} removido da lista de permitidos.`);
      } else {
        await msg.reply(`⚠️ Contato não encontrado na lista.`);
      }
      return;
    }

    // Listar contatos permitidos (apenas o próprio usuário pode fazer isso)
    if (msg.fromMe && texto === 'listar permitidos') {
      if (contatosPermitidos.length === 0) {
        await msg.reply('📭 Nenhum contato na lista de permitidos.');
      } else {
        let lista = '📋 Contatos permitidos:\n\n';
        contatosPermitidos.forEach((numero, i) => {
          lista += `${i + 1}. ${numero}\n`;
        });
        await msg.reply(lista);
      }
      return;
    }

    // Configurar chat próprio (apenas o próprio usuário pode fazer isso)
    if (msg.fromMe && texto === 'configurar chat') {
      chatProprio = msg.from;
      salvarDados('chat_proprio', { chatId: chatProprio });
      await msg.reply(`✅ Este chat foi configurado como seu chat principal com o bot. Agora o bot só responderá às suas mensagens neste chat.`);
      return;
    }

    /* --- Registrar gasto por texto --- */
    const regexGasto = /gastei\s*r?\$?\s*(\d+[.,]?\d*)\s+com\s+(.+)/i;
    const matchGasto = texto.match(regexGasto);
    if (matchGasto) {
      const valor = parseFloat(matchGasto[1].replace(',', '.'));
      let categoria = matchGasto[2].trim();
      
      // Tenta categorizar automaticamente
      const categoriaAutomatica = categorizarGasto(categoria);
      if (categoriaAutomatica !== 'outros') {
        categoria = categoriaAutomatica;
      }

      const entrada = { 
        valor, 
        categoria, 
        data: new Date().toISOString(),
        autor: msg.fromMe ? 'eu' : numeroRemetente,
        tipo: 'texto'
      };
      gastos.push(entrada);
      salvarDados('gastos', gastos);

      let resposta = `💸 Gasto registrado: R$${valor.toFixed(2)} com ${categoria}`;
      
      // Verifica orçamentos
      const alertas = verificarOrcamentos();
      if (alertas.length > 0) {
        resposta += '\n\n' + alertas.join('\n');
      }

      await msg.reply(resposta);
      return;
    }

    /* --- Registrar receita --- */
    const regexReceita = /recebi\s*r?\$?\s*(\d+[.,]?\d*)\s+(?:de|com)\s+(.+)/i;
    const matchReceita = texto.match(regexReceita);
    if (matchReceita) {
      const valor = parseFloat(matchReceita[1].replace(',', '.'));
      const fonte = matchReceita[2].trim();

      const entrada = { 
        valor, 
        categoria: 'receita',
        fonte,
        data: new Date().toISOString(),
        autor: msg.fromMe ? 'eu' : numeroRemetente,
        tipo: 'receita'
      };
      gastos.push(entrada);
      salvarDados('gastos', gastos);

      await msg.reply(`💰 Receita registrada: R$${valor.toFixed(2)} de ${fonte}`);
      return;
    }

    /* --- Registrar gasto por foto --- */
    if (msg.hasMedia && texto.includes('comprovante')) {
      try {
        const media = await msg.downloadMedia();
        
        // Salvar a imagem
        const timestamp = Date.now();
        const filename = `comprovante_${timestamp}.${media.mimetype.split('/')[1]}`;
        const filepath = path.join(diretorioComprovantes, filename);
        
        fs.writeFileSync(filepath, Buffer.from(media.data, 'base64'));
        
        // Registrar o gasto (valor padrão até que o usuário especifique)
        const entrada = { 
          valor: 0, // Valor temporário
          categoria: 'outros',
          data: new Date().toISOString(),
          autor: msg.fromMe ? 'eu' : numeroRemetente,
          tipo: 'comprovante',
          comprovante: filename
        };
        
        gastos.push(entrada);
        salvarDados('gastos', gastos);
        
        await msg.reply(`📸 Comprovante salvo! Por favor, informe o valor e a categoria usando o comando:\n*valor comprovante R$XX.XX categoria*`);
      } catch (error) {
        console.error('Erro ao processar comprovante:', error);
        await msg.reply('❌ Erro ao processar o comprovante. Tente novamente.');
      }
      return;
    }

    /* --- Atualizar valor e categoria do último comprovante --- */
    const regexComprovante = /valor\s+comprovante\s*r?\$?\s*(\d+[.,]?\d*)\s+(.+)/i;
    const matchComprovante = texto.match(regexComprovante);
    if (matchComprovante) {
      // Encontrar o último gasto do tipo comprovante
      const index = gastos.map(g => g.tipo).lastIndexOf('comprovante');
      
      if (index !== -1) {
        const valor = parseFloat(matchComprovante[1].replace(',', '.'));
        let categoria = matchComprovante[2].trim();
        
        // Tenta categorizar automaticamente
        const categoriaAutomatica = categorizarGasto(categoria);
        if (categoriaAutomatica !== 'outros') {
          categoria = categoriaAutomatica;
        }
        
        gastos[index].valor = valor;
        gastos[index].categoria = categoria;
        
        salvarDados('gastos', gastos);
        
        let resposta = `✅ Comprovante atualizado: R$${valor.toFixed(2)} com ${categoria}`;
        
        // Verifica orçamentos
        const alertas = verificarOrcamentos();
        if (alertas.length > 0) {
          resposta += '\n\n' + alertas.join('\n');
        }
        
        await msg.reply(resposta);
      } else {
        await msg.reply('❌ Nenhum comprovante recente encontrado para atualizar.');
      }
      return;
    }

    /* --- Definir orçamento --- */
    const regexOrcamento = /(?:definir|criar)\s+or[çc]amento\s+(?:de|para)\s+(.+)\s+r?\$?\s*(\d+[.,]?\d*)/i;
    const matchOrcamento = texto.match(regexOrcamento);
    if (matchOrcamento) {
      const categoria = matchOrcamento[1].trim().toLowerCase();
      const valor = parseFloat(matchOrcamento[2].replace(',', '.'));
      
      orcamentos[categoria] = valor;
      salvarDados('orcamentos', orcamentos);
      
      await msg.reply(`✅ Orçamento definido: R$${valor.toFixed(2)} para ${categoria}`);
      return;
    }

    /* --- Adicionar palavra-chave a uma categoria --- */
    const regexCategoria = /adicionar\s+(.+)\s+(?:à|a|na)\s+categoria\s+(.+)/i;
    const matchCategoria = texto.match(regexCategoria);
    if (matchCategoria) {
      const palavraChave = matchCategoria[1].trim().toLowerCase();
      const categoria = matchCategoria[2].trim().toLowerCase();
      
      if (!categorias[categoria]) {
        categorias[categoria] = [];
      }
      
      if (!categorias[categoria].includes(palavraChave)) {
        categorias[categoria].push(palavraChave);
        salvarDados('categorias', categorias);
        await msg.reply(`✅ Palavra-chave "${palavraChave}" adicionada à categoria "${categoria}"`);
      } else {
        await msg.reply(`⚠️ Palavra-chave "${palavraChave}" já existe na categoria "${categoria}"`);
      }
      return;
    }

    /* --- Resumo --- */
    if (texto === 'resumo') {
      if (gastos.length === 0) {
        await msg.reply('📭 Nenhum gasto registrado ainda.');
      } else {
        const gastosRecentes = gastos.filter(g => g.tipo !== 'receita');
        const receitas = gastos.filter(g => g.tipo === 'receita');
        
        const totalGastos = gastosRecentes.reduce((soma, g) => soma + g.valor, 0);
        const totalReceitas = receitas.reduce((soma, g) => soma + g.valor, 0);
        const saldo = totalReceitas - totalGastos;
        
        let resumo = `📊 *RESUMO FINANCEIRO*\n\n`;
        resumo += `💰 Total de receitas: R$${totalReceitas.toFixed(2)}\n`;
        resumo += `💸 Total de gastos: R$${totalGastos.toFixed(2)}\n`;
        resumo += `${saldo >= 0 ? '✅' : '❌'} Saldo: R$${saldo.toFixed(2)}\n\n`;
        
        resumo += `*Últimos 5 gastos:*\n`;
        const ultimosGastos = [...gastosRecentes].sort((a, b) => new Date(b.data) - new Date(a.data)).slice(0, 5);
        
        ultimosGastos.forEach((g, i) => {
          const data = formatarData(g.data);
          const autorTexto = g.autor ? ` (por ${g.autor === 'eu' ? 'você' : g.autor})` : '';
          resumo += `${i + 1}. ${data} - ${g.categoria}: R$${g.valor.toFixed(2)}${autorTexto}\n`;
        });
        
        await msg.reply(resumo);
      }
      return;
    }

    /* --- Resumo por categoria --- */
    if (texto === 'resumo por categoria') {
      if (gastos.length === 0) {
        await msg.reply('📭 Nenhum gasto registrado ainda.');
      } else {
        const gastosRecentes = gastos.filter(g => g.tipo !== 'receita');
        const totalPorCategoria = {};
        
        gastosRecentes.forEach(gasto => {
          if (!totalPorCategoria[gasto.categoria]) {
            totalPorCategoria[gasto.categoria] = 0;
          }
          totalPorCategoria[gasto.categoria] += gasto.valor;
        });
        
        let resumo = `📊 *GASTOS POR CATEGORIA*\n\n`;
        
        // Ordenar categorias por valor (do maior para o menor)
        const categorias = Object.entries(totalPorCategoria)
          .sort((a, b) => b[1] - a[1])
          .map(([categoria, valor]) => `${categoria}: R$${valor.toFixed(2)}`);
        
        resumo += categorias.join('\n');
        
        await msg.reply(resumo);
      }
      return;
    }

    /* --- Resumo por período --- */
    const regexPeriodo = /resumo\s+(hoje|semana|m[êe]s|ano)/i;
    const matchPeriodo = texto.match(regexPeriodo);
    if (matchPeriodo) {
      const periodo = matchPeriodo[1].toLowerCase().replace('ê', 'e');
      
      const gastosNoPeriodo = gastosPorPeriodo(periodo).filter(g => g.tipo !== 'receita');
      
      if (gastosNoPeriodo.length === 0) {
        await msg.reply(`📭 Nenhum gasto registrado para ${periodo}.`);
      } else {
        const total = gastosNoPeriodo.reduce((soma, g) => soma + g.valor, 0);
        
        let resumo = `📊 *RESUMO DE ${periodo.toUpperCase()}*\n\n`;
        resumo += `Total: R$${total.toFixed(2)}\n\n`;
        
        // Agrupar por categoria
        const porCategoria = {};
        gastosNoPeriodo.forEach(gasto => {
          if (!porCategoria[gasto.categoria]) {
            porCategoria[gasto.categoria] = 0;
          }
          porCategoria[gasto.categoria] += gasto.valor;
        });
        
        // Ordenar categorias por valor
        const categorias = Object.entries(porCategoria)
          .sort((a, b) => b[1] - a[1])
          .map(([categoria, valor]) => {
            const percentual = (valor / total) * 100;
            return `${categoria}: R$${valor.toFixed(2)} (${percentual.toFixed(0)}%)`;
          });
        
        resumo += categorias.join('\n');
        
        await msg.reply(resumo);
      }
      return;
    }

    /* --- Insights --- */
    if (texto === 'insights' || texto === 'dicas') {
      const insights = gerarInsights();
      
      if (insights.length === 0) {
        await msg.reply('📊 Registre mais gastos para receber insights personalizados.');
      } else {
        await msg.reply(`📊 *INSIGHTS FINANCEIROS*\n\n${insights.join('\n\n')}`);
      }
      return;
    }

    /* --- Orçamentos --- */
    if (texto === 'orçamentos' || texto === 'orcamentos') {
      if (Object.keys(orcamentos).length === 0) {
        await msg.reply('📭 Nenhum orçamento definido ainda. Use "definir orçamento para CATEGORIA R$XX" para criar.');
      } else {
        const gastosDoMes = gastosPorPeriodo('mes');
        const totalPorCategoria = {};
        
        gastosDoMes.forEach(gasto => {
          if (!totalPorCategoria[gasto.categoria]) {
            totalPorCategoria[gasto.categoria] = 0;
          }
          totalPorCategoria[gasto.categoria] += gasto.valor;
        });
        
        let resumo = `📊 *ORÇAMENTOS DO MÊS*\n\n`;
        
        for (const [categoria, limite] of Object.entries(orcamentos)) {
          const gasto = totalPorCategoria[categoria] || 0;
          const percentual = (gasto / limite) * 100;
          const status = percentual >= 100 ? '🚨' : percentual >= 90 ? '⚠️' : '✅';
          
          resumo += `${status} ${categoria}: R$${gasto.toFixed(2)} de R$${limite.toFixed(2)} (${percentual.toFixed(0)}%)\n`;
        }
        
        await msg.reply(resumo);
      }
      return;
    }

    /* --- Excluir último gasto --- */
    if (texto === 'excluir último' || texto === 'excluir ultimo') {
      if (gastos.length === 0) {
        await msg.reply('📭 Nenhum gasto registrado para excluir.');
      } else {
        const ultimoGasto = gastos.pop();
        salvarDados('gastos', gastos);
        
        await msg.reply(`✅ Último registro excluído: R$${ultimoGasto.valor.toFixed(2)} com ${ultimoGasto.categoria}`);
      }
      return;
    }

    /* --- Ranking de gastos --- */
    if (texto === 'ranking' || texto === 'ranking de gastos') {
      if (gastos.length === 0) {
        await msg.reply('📭 Nenhum gasto registrado ainda.');
      } else {
        const gastosDoMes = gastosPorPeriodo('mes').filter(g => g.tipo !== 'receita');
        
        if (gastosDoMes.length === 0) {
          await msg.reply('📭 Nenhum gasto registrado este mês.');
          return;
        }
        
        // Agrupar por categoria
        const porCategoria = {};
        gastosDoMes.forEach(gasto => {
          if (!porCategoria[gasto.categoria]) {
            porCategoria[gasto.categoria] = 0;
          }
          porCategoria[gasto.categoria] += gasto.valor;
        });
        
        // Ordenar categorias por valor
        const ranking = Object.entries(porCategoria)
          .sort((a, b) => b[1] - a[1]);
        
        let resposta = `🏆 *RANKING DE GASTOS DO MÊS*\n\n`;
        
        ranking.forEach((item, index) => {
          const [categoria, valor] = item;
          const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
          resposta += `${medal} ${categoria}: R$${valor.toFixed(2)}\n`;
        });
        
        await msg.reply(resposta);
      }
      return;
    }

    /* --- Status do servidor --- */
    if (texto === 'status' || texto === 'status servidor') {
      const uptime = process.uptime();
      const dias = Math.floor(uptime / 86400);
      const horas = Math.floor((uptime % 86400) / 3600);
      const minutos = Math.floor((uptime % 3600) / 60);
      
      let status = `🖥️ *STATUS DO SERVIDOR*\n\n`;
      status += `✅ Bot está online\n`;
      status += `⏱️ Tempo de atividade: ${dias}d ${horas}h ${minutos}m\n`;
      status += `📊 Gastos registrados: ${gastos.length}\n`;
      status += `👥 Contatos permitidos: ${contatosPermitidos.length}\n`;
      status += `💾 Versão do Node.js: ${process.version}\n`;
      
      await msg.reply(status);
      return;
    }

    /* --- Ajuda --- */
    if (texto === 'ajuda') {
      let mensagemAjuda = `🤖 *COMANDOS DISPONÍVEIS*\n\n`;
      
      mensagemAjuda += `*Registrar Transações:*\n`;
      mensagemAjuda += `- *Gastei R$XX com YYY* → Registra um gasto\n`;
      mensagemAjuda += `- *Recebi R$XX de YYY* → Registra uma receita\n`;
      mensagemAjuda += `- Envie uma foto com a palavra *comprovante* → Registra gasto com comprovante\n`;
      mensagemAjuda += `- *Valor comprovante R$XX categoria* → Define valor e categoria do último comprovante\n\n`;
      
      mensagemAjuda += `*Consultas:*\n`;
      mensagemAjuda += `- *Resumo* → Mostra resumo geral\n`;
      mensagemAjuda += `- *Resumo por categoria* → Mostra gastos agrupados por categoria\n`;
      mensagemAjuda += `- *Resumo hoje/semana/mês/ano* → Mostra gastos do período\n`;
      mensagemAjuda += `- *Ranking* → Mostra ranking de gastos por categoria\n`;
      mensagemAjuda += `- *Insights* → Receba dicas personalizadas\n`;
      mensagemAjuda += `- *Orçamentos* → Veja seus orçamentos e limites\n\n`;
      
      mensagemAjuda += `*Configurações:*\n`;
      mensagemAjuda += `- *Definir orçamento para CATEGORIA R$XX* → Cria limite de gastos\n`;
      mensagemAjuda += `- *Adicionar PALAVRA à categoria CATEGORIA* → Personaliza categorização\n`;
      mensagemAjuda += `- *Excluir último* → Remove o último registro\n`;
      mensagemAjuda += `- *Configurar chat* → Define este chat como principal\n`;
      mensagemAjuda += `- *Status* → Verifica status do servidor\n`;

      // Adiciona comandos de administração apenas para o próprio usuário
      if (msg.fromMe) {
        mensagemAjuda += `\n👑 *Comandos de Administração:*\n`;
        mensagemAjuda += `- *Permitir NÚMERO* → Adiciona contato à lista de permitidos\n`;
        mensagemAjuda += `- *Remover NÚMERO* → Remove contato da lista de permitidos\n`;
        mensagemAjuda += `- *Listar permitidos* → Mostra todos os contatos permitidos\n`;
      }

      await msg.reply(mensagemAjuda);
      return;
    }
  } catch (error) {
    console.error('Erro ao processar mensagem:', error);
    try {
      await msg.reply('❌ Ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.');
    } catch (replyError) {
      console.error('Erro ao enviar mensagem de erro:', replyError);
    }
  }
});

// Inicializar o cliente
client.initialize();

// Exportar o cliente para uso em outros módulos
module.exports = client;
