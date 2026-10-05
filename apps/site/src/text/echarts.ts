/**
 * ECharts' own words in European Portuguese: month and weekday names on time axes, the legend's
 * selector, the toolbox, and the sentences its accessibility layer reads out. ECharts ships only a
 * Brazilian translation; this follows its keys.
 */
export const ECHARTS_PT = {
  time: {
    month: ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"],
    monthAbbr: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"],
    dayOfWeek: ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"],
    dayOfWeekAbbr: ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"],
  },
  legend: {
    selector: { all: "Todas", inverse: "Inverter" },
  },
  toolbox: {
    brush: {
      title: {
        rect: "Seleção retangular",
        polygon: "Seleção em laço",
        lineX: "Selecionar na horizontal",
        lineY: "Selecionar na vertical",
        keep: "Manter as seleções",
        clear: "Limpar as seleções",
      },
    },
    dataView: { title: "Ver os dados", lang: ["Ver os dados", "Fechar", "Atualizar"] },
    dataZoom: { title: { zoom: "Ampliar", back: "Repor a ampliação" } },
    magicType: { title: { line: "Mudar para gráfico de linhas", bar: "Mudar para gráfico de barras", stack: "Empilhar", tiled: "Lado a lado" } },
    restore: { title: "Repor" },
    saveAsImage: { title: "Guardar como imagem", lang: ["Clique com o botão direito para guardar a imagem"] },
  },
  series: {
    typeNames: {
      pie: "Gráfico circular",
      bar: "Gráfico de barras",
      line: "Gráfico de linhas",
      scatter: "Gráfico de dispersão",
      effectScatter: "Gráfico de dispersão com ondulação",
      radar: "Gráfico radar",
      tree: "Árvore",
      treemap: "Mapa em árvore",
      boxplot: "Diagrama de caixa",
      candlestick: "Gráfico de velas",
      k: "Gráfico de linhas K",
      heatmap: "Mapa de calor",
      map: "Mapa",
      parallel: "Coordenadas paralelas",
      lines: "Gráfico de linhas",
      graph: "Grafo de relações",
      sankey: "Diagrama de Sankey",
      funnel: "Gráfico de funil",
      gauge: "Indicador",
      pictorialBar: "Barras pictóricas",
      themeRiver: "Gráfico de rio temático",
      sunburst: "Gráfico de explosão solar",
      custom: "Gráfico personalizado",
      chart: "Gráfico",
    },
  },
  aria: {
    general: { withTitle: "Este é um gráfico sobre “{title}”", withoutTitle: "Este é um gráfico" },
    series: {
      single: { prefix: "", withName: " do tipo {seriesType} com o nome {seriesName}.", withoutName: " do tipo {seriesType}." },
      multiple: {
        prefix: ". É composto por {seriesCount} séries.",
        withName: " A série {seriesId} é um {seriesType} que representa {seriesName}.",
        withoutName: " A série {seriesId} é um {seriesType}.",
        separator: { middle: "", end: "" },
      },
    },
    data: {
      allData: "Os dados são os seguintes: ",
      partialData: "Os primeiros {displayCnt} elementos são: ",
      withName: "o valor de {name} é {value}",
      withoutName: "{value}",
      separator: { middle: ", ", end: ". " },
    },
  },
};
