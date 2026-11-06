const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkbook } = require('../xlsx');

test('creates a readable XLSX workbook with an embedded Excel chart', async () => {
    const buffer = await createWorkbook([
        {
            name: 'Ответы',
            rows: [
                ['Получатель', 'Ответ'],
                ['Анна', 'Да'],
                ['Иван', 'Нет']
            ]
        },
        {
            name: 'Диаграммы',
            rows: [
                ['Статистика ответов'],
                ['Сводная диаграмма по результатам']
            ],
            charts: [
                {
                    title: 'Ответы получателей',
                    type: 'doughnut',
                    seriesName: 'Количество',
                    categories: {
                        range: { sheet: 'Данные графиков', column: 'A', startRow: 2, endRow: 3 },
                        values: ['Ответили', 'Ожидают']
                    },
                    values: {
                        range: { sheet: 'Данные графиков', column: 'B', startRow: 2, endRow: 3 },
                        values: [2, 1]
                    }
                }
            ]
        },
        {
            name: 'Данные графиков',
            rows: [
                ['Статус', 'Количество'],
                ['Ответили', 2],
                ['Ожидают', 1]
            ]
        }
    ]);

    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(buffer.subarray(0, 2).toString('ascii'), 'PK');

    const { Workbook } = await import('@node-projects/excelforge');
    const reopened = await Workbook.fromBytes(buffer);

    assert.deepEqual(reopened.getSheetNames(), ['Ответы', 'Диаграммы', 'Данные графиков']);
    const chartSheet = reopened.getSheet('Диаграммы');
    assert.ok(chartSheet);
    assert.equal(chartSheet.getCharts().length, 1);
    assert.equal(chartSheet.getCharts()[0].type, 'doughnut');
});
