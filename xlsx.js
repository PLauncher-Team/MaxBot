async function createWorkbook(inputSheets) {
    const { Workbook, style } = await import('@node-projects/excelforge');
    const workbook = new Workbook();
    workbook.coreProperties = {
        title: 'Ответы получателей',
        creator: 'MaxBot',
        subject: 'Статистика обратной связи'
    };

    const headerStyle = style()
        .bold()
        .fontSize(11)
        .bg('FF4263EB')
        .fontColor('FFFFFFFF')
        .center()
        .wrap()
        .border('thin', 'FFE3E8F0')
        .build();
    const bodyStyle = style()
        .fontSize(10)
        .wrap()
        .border('thin', 'FFE3E8F0')
        .build();
    const alternateStyle = style()
        .fontSize(10)
        .bg('FFF3F6FC')
        .wrap()
        .border('thin', 'FFE3E8F0')
        .build();
    const titleStyle = style()
        .bold()
        .fontSize(18)
        .fontColor('FF172033')
        .wrap()
        .build();
    const descriptionStyle = style()
        .fontSize(10)
        .fontColor('FF657087')
        .wrap()
        .build();

    const sheetMap = new Map();
    for (const inputSheet of inputSheets) {
        const sheet = workbook.addSheet(inputSheet.name, {
            state: inputSheet.hidden ? 'hidden' : 'visible'
        });
        sheetMap.set(inputSheet.name, sheet);
        const rows = Array.isArray(inputSheet.rows) ? inputSheet.rows : [];
        if (rows.length) sheet.writeArray(1, 1, rows);

        const columnCount = Math.max(1, ...rows.map(row => Array.isArray(row) ? row.length : 0));
        for (let column = 1; column <= columnCount; column++) {
            const longest = rows.reduce((max, row) => {
                const value = Array.isArray(row) ? row[column - 1] : '';
                return Math.max(max, String(value ?? '').length);
            }, 0);
            sheet.setColumnWidth(column, Math.max(14, Math.min(48, longest + 3)));
        }

        rows.forEach((row, rowIndex) => {
            const values = Array.isArray(row) ? row : [];
            const height = rowIndex === 0
                ? (inputSheet.name === 'Диаграммы' ? 38 : 48)
                : Math.max(26, Math.min(72, 22 + Math.ceil(Math.max(0, ...values.map(value => String(value ?? '').length)) / 52) * 14));
            sheet.setRowHeight(rowIndex + 1, height);
            values.forEach((value, columnIndex) => {
                if (inputSheet.name === 'Диаграммы' && rowIndex === 0) {
                    sheet.setStyle(rowIndex + 1, columnIndex + 1, titleStyle);
                } else if (inputSheet.name === 'Диаграммы' && rowIndex === 1) {
                    sheet.setStyle(rowIndex + 1, columnIndex + 1, descriptionStyle);
                } else {
                    sheet.setStyle(rowIndex + 1, columnIndex + 1,
                        rowIndex === 0 ? headerStyle : (rowIndex % 2 === 0 ? alternateStyle : bodyStyle));
                }
            });
        });

        if (rows.length > 1 && inputSheet.name !== 'Диаграммы') {
            const lastColumn = columnLetter(columnCount);
            sheet.autoFilter = { ref: 'A1:' + lastColumn + rows.length };
            sheet.freeze(1, 0);
        }
    }

    function columnLetter(index) {
        let value = index;
        let result = '';
        while (value > 0) {
            const remainder = (value - 1) % 26;
            result = String.fromCharCode(65 + remainder) + result;
            value = Math.floor((value - 1) / 26);
        }
        return result;
    }

    function quotedSheetName(name) {
        return "'" + String(name).replace(/'/g, "''") + "'";
    }

    function chartRange(range, description) {
        const sheetName = range?.sheet;
        const column = String(range?.column || '').toUpperCase();
        const startRow = range?.startRow;
        const endRow = range?.endRow;
        if (
            typeof sheetName !== 'string' || !sheetName.trim() ||
            !/^[A-Z]{1,3}$/.test(column) ||
            !Number.isInteger(startRow) || startRow < 1 ||
            !Number.isInteger(endRow) || endRow < startRow
        ) {
            throw new Error(
                'Invalid ' + description + ' chart range. Expected sheet, column, startRow and endRow.'
            );
        }
        const dollar = String.fromCharCode(36);
        return quotedSheetName(sheetName) + '!' + dollar + column + dollar +
            startRow + ':' + dollar + column + dollar + endRow;
    }

    for (const inputSheet of inputSheets) {
        if (!Array.isArray(inputSheet.charts) || inputSheet.charts.length === 0) continue;
        const sheet = sheetMap.get(inputSheet.name);
        if (!sheet) continue;
        inputSheet.charts.forEach((chart, index) => {
            const left = index % 2;
            const top = Math.floor(index / 2);
            const startRow = 3 + top * 18;
            const startColumn = left * 9;
            const type = chart.type;
            const chartOptions = {
                type,
                title: chart.title || '',
                series: [{
                    name: chart.seriesName || chart.title || 'Количество',
                    values: chartRange(chart.values?.range, 'values'),
                    categories: chartRange(chart.categories?.range, 'categories')
                }],
                from: { col: startColumn, row: startRow },
                to: { col: startColumn + 8, row: startRow + 15 },
                legend: 'bottom',
                colorPalette: type === 'doughnut' ? 'green' : 'blue',
                roundedCorners: true,
                shadow: true,
            };
            if (type === 'doughnut' || type === 'pie') {
                chartOptions.dataLabels = {
                    showCategory: true,
                    showPercent: true,
                    position: 'bestFit'
                };
            } else if (type === 'bar' || type === 'column') {
                chartOptions.dataLabels = {
                    showValue: true,
                    position: 'outEnd'
                };
            }
            sheet.addChart(chartOptions);
        });
    }

    if (sheetMap.has('Диаграммы')) workbook.setActiveSheet('Диаграммы');
    return Buffer.from(await workbook.build());
}

module.exports = { createWorkbook };
 + column + '

    for (const inputSheet of inputSheets) {
        if (!Array.isArray(inputSheet.charts) || inputSheet.charts.length === 0) continue;
        const sheet = sheetMap.get(inputSheet.name);
        if (!sheet) continue;
        inputSheet.charts.forEach((chart, index) => {
            const left = index % 2;
            const top = Math.floor(index / 2);
            const startRow = 3 + top * 18;
            const startColumn = left * 9;
            const type = chart.type === 'column' ? 'col' : chart.type;
            const chartOptions = {
                type,
                title: chart.title || '',
                series: [{
                    name: chart.seriesName || chart.title || 'Количество',
                    dataRange: chartRange(chart.values.range),
                    catRange: chartRange(chart.categories.range)
                }],
                from: { col: startColumn, row: startRow },
                to: { col: startColumn + 8, row: startRow + 15 },
                legend: { position: 'bottom' },
                colorPalette: type === 'doughnut' ? 'green' : 'blue',
                roundedCorners: true,
                shadow: true,
            };
            if (type === 'doughnut' || type === 'pie') {
                chartOptions.dataLabels = {
                    showCategory: true,
                    showPercent: true,
                    position: 'bestFit'
                };
            } else if (type === 'bar' || type === 'column') {
                chartOptions.dataLabels = {
                    showValue: true,
                    position: 'outEnd'
                };
            } else if (type === 'line') {
            }
            sheet.addChart(chartOptions);
        });
    }

    if (sheetMap.has('Диаграммы')) workbook.setActiveSheet('Диаграммы');
    return Buffer.from(await workbook.build());
}

module.exports = { createWorkbook };
 +
            startRow + ':

    for (const inputSheet of inputSheets) {
        if (!Array.isArray(inputSheet.charts) || inputSheet.charts.length === 0) continue;
        const sheet = sheetMap.get(inputSheet.name);
        if (!sheet) continue;
        inputSheet.charts.forEach((chart, index) => {
            const left = index % 2;
            const top = Math.floor(index / 2);
            const startRow = 3 + top * 18;
            const startColumn = left * 9;
            const type = chart.type === 'column' ? 'col' : chart.type;
            const chartOptions = {
                type,
                title: chart.title || '',
                series: [{
                    name: chart.seriesName || chart.title || 'Количество',
                    dataRange: chartRange(chart.values.range),
                    catRange: chartRange(chart.categories.range)
                }],
                from: { col: startColumn, row: startRow },
                to: { col: startColumn + 8, row: startRow + 15 },
                legend: { position: 'bottom' },
                colorPalette: type === 'doughnut' ? 'green' : 'blue',
                roundedCorners: true,
                shadow: true,
            };
            if (type === 'doughnut' || type === 'pie') {
                chartOptions.dataLabels = {
                    showCategory: true,
                    showPercent: true,
                    position: 'bestFit'
                };
            } else if (type === 'bar' || type === 'column') {
                chartOptions.dataLabels = {
                    showValue: true,
                    position: 'outEnd'
                };
            } else if (type === 'line') {
            }
            sheet.addChart(chartOptions);
        });
    }

    if (sheetMap.has('Диаграммы')) workbook.setActiveSheet('Диаграммы');
    return Buffer.from(await workbook.build());
}

module.exports = { createWorkbook };
 + column + '

    for (const inputSheet of inputSheets) {
        if (!Array.isArray(inputSheet.charts) || inputSheet.charts.length === 0) continue;
        const sheet = sheetMap.get(inputSheet.name);
        if (!sheet) continue;
        inputSheet.charts.forEach((chart, index) => {
            const left = index % 2;
            const top = Math.floor(index / 2);
            const startRow = 3 + top * 18;
            const startColumn = left * 9;
            const type = chart.type === 'column' ? 'col' : chart.type;
            const chartOptions = {
                type,
                title: chart.title || '',
                series: [{
                    name: chart.seriesName || chart.title || 'Количество',
                    dataRange: chartRange(chart.values.range),
                    catRange: chartRange(chart.categories.range)
                }],
                from: { col: startColumn, row: startRow },
                to: { col: startColumn + 8, row: startRow + 15 },
                legend: { position: 'bottom' },
                colorPalette: type === 'doughnut' ? 'green' : 'blue',
                roundedCorners: true,
                shadow: true,
            };
            if (type === 'doughnut' || type === 'pie') {
                chartOptions.dataLabels = {
                    showCategory: true,
                    showPercent: true,
                    position: 'bestFit'
                };
            } else if (type === 'bar' || type === 'column') {
                chartOptions.dataLabels = {
                    showValue: true,
                    position: 'outEnd'
                };
            } else if (type === 'line') {
            }
            sheet.addChart(chartOptions);
        });
    }

    if (sheetMap.has('Диаграммы')) workbook.setActiveSheet('Диаграммы');
    return Buffer.from(await workbook.build());
}

module.exports = { createWorkbook };
 + endRow;
    }

    for (const inputSheet of inputSheets) {
        if (!Array.isArray(inputSheet.charts) || inputSheet.charts.length === 0) continue;
        const sheet = sheetMap.get(inputSheet.name);
        if (!sheet) continue;
        inputSheet.charts.forEach((chart, index) => {
            const left = index % 2;
            const top = Math.floor(index / 2);
            const startRow = 3 + top * 18;
            const startColumn = left * 9;
            const type = chart.type === 'column' ? 'col' : chart.type;
            const chartOptions = {
                type,
                title: chart.title || '',
                series: [{
                    name: chart.seriesName || chart.title || 'Количество',
                    dataRange: chartRange(chart.values.range),
                    catRange: chartRange(chart.categories.range)
                }],
                from: { col: startColumn, row: startRow },
                to: { col: startColumn + 8, row: startRow + 15 },
                legend: { position: 'bottom' },
                colorPalette: type === 'doughnut' ? 'green' : 'blue',
                roundedCorners: true,
                shadow: true,
            };
            if (type === 'doughnut' || type === 'pie') {
                chartOptions.dataLabels = {
                    showCategory: true,
                    showPercent: true,
                    position: 'bestFit'
                };
            } else if (type === 'bar' || type === 'column') {
                chartOptions.dataLabels = {
                    showValue: true,
                    position: 'outEnd'
                };
            } else if (type === 'line') {
            }
            sheet.addChart(chartOptions);
        });
    }

    if (sheetMap.has('Диаграммы')) workbook.setActiveSheet('Диаграммы');
    return Buffer.from(await workbook.build());
}

module.exports = { createWorkbook };
