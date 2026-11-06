const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkbook } = require('../xlsx');

test('creates a readable XLSX workbook without chart or chart-data sheets', async () => {
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
            name: 'Статистика',
            rows: [
                ['Показатель', 'Значение'],
                ['Всего получателей', 2],
                ['Ответили', 2]
            ]
        },
        {
            name: 'Варианты ответов',
            rows: [
                ['Вариант ответа', 'Количество'],
                ['Да', 1],
                ['Нет', 1]
            ]
        }
    ]);

    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(buffer.subarray(0, 2).toString('ascii'), 'PK');

    const { Workbook } = await import('@node-projects/excelforge');
    const reopened = await Workbook.fromBytes(buffer);

    const expectedSheets = ['Ответы', 'Статистика', 'Варианты ответов'];
    assert.deepEqual(reopened.getSheetNames(), expectedSheets);
    assert.ok(!reopened.getSheetNames().includes('Диаграммы'));
    assert.ok(!reopened.getSheetNames().includes('Данные графиков'));

    for (const sheetName of expectedSheets) {
        const sheet = reopened.getSheet(sheetName);
        assert.ok(sheet, 'Expected sheet "' + sheetName + '" to exist');
        assert.equal(sheet.getCharts().length, 0);
    }
});
