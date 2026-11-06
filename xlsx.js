const zlib = require('zlib');

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit++) {
        crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    return crc >>> 0;
});

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function zipFiles(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const fileDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

    files.forEach(file => {
        const name = Buffer.from(file.name, 'utf8');
        const data = Buffer.from(file.content, 'utf8');
        const compressed = zlib.deflateRawSync(data);
        const checksum = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(8, 8);
        local.writeUInt16LE(0, 10);
        local.writeUInt16LE(fileDate, 12);
        local.writeUInt32LE(checksum, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        localParts.push(local, name, compressed);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(8, 10);
        central.writeUInt16LE(0, 12);
        central.writeUInt16LE(fileDate, 14);
        central.writeUInt32LE(checksum, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(0, 38);
        central.writeUInt32LE(offset, 42);
        centralParts.push(central, name);
        offset += local.length + name.length + compressed.length;
    });

    const centralDirectory = Buffer.concat(centralParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralDirectory.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);
    return Buffer.concat([...localParts, centralDirectory, end]);
}

function xmlEscape(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function columnName(index) {
    let name = '';
    let value = index + 1;
    while (value > 0) {
        const remainder = (value - 1) % 26;
        name = String.fromCharCode(65 + remainder) + name;
        value = Math.floor((value - 1) / 26);
    }
    return name;
}

function worksheetXml(rows, hasDrawing) {
    const maxColumns = Math.max(1, rows.reduce((max, row) => Math.max(max, row.length), 0));
    const widths = Array.from({ length: maxColumns }, (_, column) => {
        const longest = rows.reduce((max, row) => Math.max(max, String(row[column] ?? '').length), 0);
        return Math.max(13, Math.min(44, longest + 3));
    });
    const cols = widths.map((width, index) =>
        '<col min="' + (index + 1) + '" max="' + (index + 1) + '" width="' + width + '" customWidth="1"/>'
    ).join('');
    const sheetRows = rows.map((row, rowIndex) => {
        const cells = row.map((value, columnIndex) => {
            const reference = columnName(columnIndex) + (rowIndex + 1);
            const style = rowIndex === 0 ? ' s="1"' : '';
            if (typeof value === 'number' && Number.isFinite(value)) {
                return '<c r="' + reference + '"' + style + '><v>' + value + '</v></c>';
            }
            if (typeof value === 'boolean') {
                return '<c r="' + reference + '"' + style + ' t="b"><v>' + (value ? 1 : 0) + '</v></c>';
            }
            return '<c r="' + reference + '"' + style + ' t="inlineStr"><is><t xml:space="preserve">' + xmlEscape(value) + '</t></is></c>';
        }).join('');
        const height = rowIndex === 0 ? 56 : 24;
        return '<row r="' + (rowIndex + 1) + '" ht="' + height + '" customHeight="1">' + cells + '</row>';
    }).join('');
    const lastColumn = columnName(maxColumns - 1);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheetViews><sheetView workbookViewId="0" showGridLines="0" zoomScale="90"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
        '<sheetFormatPr defaultRowHeight="21"/><cols>' + cols + '</cols><sheetData>' + sheetRows + '</sheetData>' +
        '<autoFilter ref="A1:' + lastColumn + Math.max(1, rows.length) + '"/>' +
        (hasDrawing ? '<drawing r:id="rId1"/>' : '') +
        '<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>' +
        '</worksheet>';
}

function workbookStylesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="3"><font><sz val="10"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Aptos Display"/></font><font><b/><color rgb="FF172033"/><sz val="11"/><name val="Aptos"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF4263EB"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F4FA"/><bgColor indexed="64"/></patternFill></fill></fills>' +
        '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFE3E8F0"/></left><right style="thin"><color rgb="FFE3E8F0"/></right><top style="thin"><color rgb="FFE3E8F0"/></top><bottom style="thin"><color rgb="FFE3E8F0"/></bottom><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="3">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
        '<xf numFmtId="0" fontId="1" fillId="1" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
        '<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
        '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
}

function quoteSheet(name) {
    return "'" + String(name).replace(/'/g, "''") + "'";
}

function rangeFormula(range) {
    return quoteSheet(range.sheet) + '!$' + range.column + '$' + range.startRow + ':$' + range.column + '$' + range.endRow;
}

function cachedStringRange(values) {
    return '<c:strCache><c:ptCount val="' + values.length + '"/>' +
        values.map((value, index) => '<c:pt idx="' + index + '"><c:v>' + xmlEscape(value) + '</c:v></c:pt>').join('') +
        '</c:strCache>';
}

function cachedNumberRange(values) {
    return '<c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="' + values.length + '"/>' +
        values.map((value, index) => '<c:pt idx="' + index + '"><c:v>' + (Number(value) || 0) + '</c:v></c:pt>').join('') +
        '</c:numCache>';
}

function chartSeriesXml(chart) {
    const categories = chart.categories.values;
    const values = chart.values.values;
    const name = '<c:tx><c:v>' + xmlEscape(chart.seriesName || chart.title) + '</c:v></c:tx>';
    const category = '<c:cat><c:strRef><c:f>' + xmlEscape(rangeFormula(chart.categories.range)) + '</c:f>' +
        cachedStringRange(categories) + '</c:strRef></c:cat>';
    const value = '<c:val><c:numRef><c:f>' + xmlEscape(rangeFormula(chart.values.range)) + '</c:f>' +
        cachedNumberRange(values) + '</c:numRef></c:val>';
    return '<c:ser><c:idx val="0"/><c:order val="0"/>' + name + category + value + '</c:ser>';
}

function chartTitleXml(title) {
    return '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr lang="ru-RU" sz="1400" b="1"/></a:pPr>' +
        '<a:r><a:rPr lang="ru-RU" sz="1400" b="1"/><a:t>' + xmlEscape(title) + '</a:t></a:r>' +
        '<a:endParaRPr lang="ru-RU"/></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>';
}

function axisXml(chartId, categoryPosition, valuePosition) {
    const catAxis = 100000 + chartId * 2;
    const valAxis = catAxis + 1;
    return '<c:catAx><c:axId val="' + catAxis + '"/><c:scaling><c:orientation val="' +
        (chartId === 2 ? 'minMax' : 'maxMin') + '"/></c:scaling><c:delete val="0"/><c:axPos val="' + categoryPosition +
        '"/><c:tickLblPos val="nextTo"/><c:crossAx val="' + valAxis + '"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>' +
        '<c:valAx><c:axId val="' + valAxis + '"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="' +
        valuePosition + '"/><c:majorGridlines/><c:numFmt formatCode="0" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="' +
        catAxis + '"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>';
}

function chartXml(chart, index) {
    const series = chartSeriesXml(chart);
    const prefix = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<c:date1904 val="0"/><c:lang val="ru-RU"/><c:roundedCorners val="1"/><c:chart>' +
        chartTitleXml(chart.title) + '<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>';
    let plot;
    if (chart.type === 'doughnut') {
        plot = '<c:doughnutChart><c:varyColors val="1"/>' + series +
            '<c:firstSliceAng val="270"/><c:holeSize val="62"/><c:showLegendKey val="0"/><c:extLst/>' +
            '</c:doughnutChart><c:spPr><a:solidFill><a:schemeClr val="lt1"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>';
    } else if (chart.type === 'line') {
        plot = '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>' +
            '<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>' + xmlEscape(chart.seriesName || chart.title) + '</c:v></c:tx>' +
            '<c:marker><c:symbol val="circle"/><c:size val="6"/></c:marker><c:cat><c:strRef><c:f>' +
            xmlEscape(rangeFormula(chart.categories.range)) + '</c:f>' + cachedStringRange(chart.categories.values) +
            '</c:strRef></c:cat><c:val><c:numRef><c:f>' + xmlEscape(rangeFormula(chart.values.range)) + '</c:f>' +
            cachedNumberRange(chart.values.values) + '</c:numRef></c:val><c:smooth val="0"/></c:ser>' +
            '<c:marker val="1"/><c:smooth val="0"/><c:axId val="' + (100000 + index * 2) + '"/><c:axId val="' + (100001 + index * 2) + '"/></c:lineChart>' +
            axisXml(index, 'b', 'l');
    } else {
        plot = '<c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/><c:varyColors val="0"/>' +
            series + '<c:gapWidth val="65"/><c:overlap val="0"/><c:axId val="' + (100000 + index * 2) +
            '"/><c:axId val="' + (100001 + index * 2) + '"/></c:barChart>' + axisXml(index, 'l', 'b');
    }
    return prefix + plot + '</c:plotArea><c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/></c:legend>' +
        '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:printSettings><c:headerFooter/><c:pageMargins b="0.5" l="0.25" r="0.25" t="0.5" header="0.2" footer="0.2"/><c:pageSetup/></c:printSettings></c:chartSpace>';
}

function drawingXml(charts) {
    const anchors = charts.map((chart, index) => {
        const left = index % 2;
        const top = Math.floor(index / 2);
        const fromColumn = left * 9;
        const toColumn = fromColumn + 8;
        const fromRow = top * 18;
        const toRow = fromRow + 16;
        return '<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>' + fromColumn + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + fromRow + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
            '<xdr:to><xdr:col>' + toColumn + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + toRow + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
            '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="' + (index + 2) + '" name="' + xmlEscape(chart.title) + '"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>' +
            '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
            '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId' + (index + 1) + '"/>' +
            '</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
        anchors + '</xdr:wsDr>';
}

function drawingRelationships(charts) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        charts.map((chart, index) => '<Relationship Id="rId' + (index + 1) +
            '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart' + (index + 1) + '.xml"/>').join('') +
        '</Relationships>';
}

function createWorkbook(inputSheets) {
    const sheets = inputSheets.map(sheet => ({ ...sheet, charts: Array.isArray(sheet.charts) ? sheet.charts : [] }));
    const chartSheetIndex = sheets.findIndex(sheet => sheet.charts.length);
    const chartCount = chartSheetIndex >= 0 ? sheets[chartSheetIndex].charts.length : 0;
    const sheetEntries = sheets.map((sheet, index) => ({
        ...sheet,
        path: 'xl/worksheets/sheet' + (index + 1) + '.xml',
        index
    }));
    const workbookSheets = sheetEntries.map((sheet, index) =>
        '<sheet name="' + xmlEscape(sheet.name) + '" sheetId="' + (index + 1) + '"' +
        (sheet.hidden ? ' state="hidden"' : '') + ' r:id="rId' + (index + 1) + '"/>'
    ).join('');
    const relationships = sheetEntries.map((sheet, index) =>
        '<Relationship Id="rId' + (index + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (index + 1) + '.xml"/>'
    ).join('') + '<Relationship Id="rId' + (sheetEntries.length + 1) +
        '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';

    const files = [
        {
            name: '[Content_Types].xml',
            content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
                '<Default Extension="xml" ContentType="application/xml"/>' +
                '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
                '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
                sheetEntries.map(sheet => '<Override PartName="/' + sheet.path + '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
                (chartCount ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' +
                    Array.from({ length: chartCount }, (_, index) => '<Override PartName="/xl/charts/chart' + (index + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>').join('') : '') +
                '</Types>'
        },
        {
            name: '_rels/.rels',
            content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
                '</Relationships>'
        },
        {
            name: 'xl/workbook.xml',
            content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
                '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets>' + workbookSheets + '</sheets></workbook>'
        },
        {
            name: 'xl/_rels/workbook.xml.rels',
            content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + relationships + '</Relationships>'
        },
        { name: 'xl/styles.xml', content: workbookStylesXml() },
        ...sheetEntries.map(sheet => ({
            name: sheet.path,
            content: worksheetXml(sheet.rows, sheet.charts.length > 0)
        }))
    ];

    if (chartCount) {
        const chartSheet = sheetEntries[chartSheetIndex];
        files.push({
            name: 'xl/worksheets/_rels/sheet' + (chartSheetIndex + 1) + '.xml.rels',
            content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>' +
                '</Relationships>'
        });
        files.push({ name: 'xl/drawings/drawing1.xml', content: drawingXml(chartSheet.charts) });
        files.push({ name: 'xl/drawings/_rels/drawing1.xml.rels', content: drawingRelationships(chartSheet.charts) });
        chartSheet.charts.forEach((chart, index) => {
            files.push({ name: 'xl/charts/chart' + (index + 1) + '.xml', content: chartXml(chart, index + 1) });
        });
    }

    return zipFiles(files);
}

module.exports = { createWorkbook };
