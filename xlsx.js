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
                ? 48
                : Math.max(26, Math.min(72, 22 + Math.ceil(Math.max(0, ...values.map(value => String(value ?? '').length)) / 52) * 14));
            sheet.setRowHeight(rowIndex + 1, height);
            values.forEach((value, columnIndex) => {
                sheet.setStyle(rowIndex + 1, columnIndex + 1,
                    rowIndex === 0 ? headerStyle : (rowIndex % 2 === 0 ? alternateStyle : bodyStyle));
            });
        });

        if (rows.length > 1) {
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

    return Buffer.from(await workbook.build());
}

module.exports = { createWorkbook };
