const fs = require('fs');
const moment = require('moment');
const CellRange = require('./cell-range').CellRange;
const TemplateExpression = require('./template-expression').TemplateExpression;
/**
 * @property {WorkSheetHelper} wsh
 * @property {object} data
 */
class TemplateEngine {
    /**
     * @param {WorkSheetHelper} wsh
     * @param {object} data
     */
    constructor(wsh, data) {
        this.wsh = wsh;
        this.data = data;
        // noinspection RegExpRedundantEscape
        this.regExpBlocks = /\[\[.+?\]\]/g;
        this.regExpValues = /{{.+?}}/g;
    }
    execute() {
        this.processBlocks(this.wsh.getSheetDimension(), this.data);
        this.processValues(this.wsh.getSheetDimension(), this.data);
    }
    /**
     * @param {CellRange} cellRange
     * @param {object} data
     * @return {CellRange} the new range
     */
    processBlocks(cellRange, data) {
        let restart;
        do {
            restart = false;
            this.wsh.eachCell(cellRange, (cell) => {
                let cVal = cell.value;
                if (typeof cVal !== "string") {
                    return null;
                }
                const matches = cVal.match(this.regExpBlocks);
                if (!Array.isArray(matches) || !matches.length) {
                    return null;
                }
                matches.forEach(rawExpression => {
                    const tplExp = new TemplateExpression(rawExpression, rawExpression.slice(2, -2));
                    cVal = cVal.replace(tplExp.rawExpression, '');
                    cell.value = cVal;
                    cellRange = this.processBlockPipes(cellRange, cell, tplExp.pipes, data[tplExp.valueName]);
                });
                restart = true;
                return false;
            });
        } while (restart);
        return cellRange;
    }
    /**
     * @param {CellRange} cellRange
     * @param {object} data
     */
    processValues(cellRange, data) {
        this.wsh.eachCell(cellRange, (cell) => {
            let cVal = cell.value;
            if (typeof cVal !== "string") {
                return;
            }
            const matches = cVal.match(this.regExpValues);
            if (!Array.isArray(matches) || !matches.length) {
                return;
            }
            matches.forEach(rawExpression => {
                const tplExp = new TemplateExpression(rawExpression, rawExpression.slice(2, -2));
                let resultValue = data[tplExp.valueName] || '';
                resultValue = this.processValuePipes(cell, tplExp.pipes, resultValue);
                cVal = cVal.replace(tplExp.rawExpression, resultValue);
            });
            cell.value = cVal;
        });
    }
    /**
     * @param {Cell} cell
     * @param {Array<{pipeName: string, pipeParameters: string[]}>} pipes
     * @param {string} value
     * @return {string}
     */
    processValuePipes(cell, pipes, value) {
        pipes.forEach(pipe => {
            switch (pipe.pipeName) {
                case 'date':
                    value = this.valuePipeDate.apply(this, [value].concat(pipe.pipeParameters));
                    break;
                case 'image':
                    value = this.valuePipeImage.apply(this, [cell, value].concat(pipe.pipeParameters));
                    break;
                case 'find':
                    value = this.valuePipeFind.apply(this, [value].concat(pipe.pipeParameters));
                    break;
                case 'get':
                    value = this.valuePipeGet.apply(this, [value].concat(pipe.pipeParameters));
                    break;
                default:
                    console.log('The value pipe not found:', pipe.pipeName);
            }
        });
        return value || '';
    }
    /**
     * @param {CellRange} cellRange
     * @param {Cell} cell
     * @param {Array<{pipeName: string, pipeParameters: string[]}>} pipes
     * @param {object|object[]} data
     * @return {CellRange} the new cell range
     */
    processBlockPipes(cellRange, cell, pipes, data) {
        // console.log('bp', pipes, data);
        const newRange = CellRange.createFromRange(cellRange);
        let insertedRows;
        pipes.forEach(pipe => {
            switch (pipe.pipeName) {
                case 'repeat-rows':
                    // insertedRows = this.blockPipeRepeatRows.apply(this, [cell, data].concat(pipe.pipeParameters));
                    insertedRows = this.blockPipeRepeatRows(cell, data, ...pipe.pipeParameters);
                    newRange.bottom += insertedRows;
                    break;
                case 'tile':
                    insertedRows = this.blockPipeTile(cell, data, ...pipe.pipeParameters);
                    newRange.bottom += insertedRows;
                    break;
                case 'filter':
                    data = this.blockPipeFilter.apply(this, [data].concat(pipe.pipeParameters));
                    break;
                default:
                    console.warn('The block pipe not found:', pipe.pipeName, pipe.pipeParameters);
            }
        });
        return newRange;
    }
    /**
     * @param {number|string} date
     * @return {string}
     */
    valuePipeDate(date) {
        return date ? moment(new Date(date)).format('DD.MM.YYYY') : '';
    }
    /**
     * @param {Cell} cell
     * @param {string} fileName
     * @return {string}
     */
    valuePipeImage(cell, fileName) {
        if (fs.existsSync(fileName)) {
            this.wsh.addImage(fileName, cell);
            return fileName;
        }
        return `File "${fileName}" not found`;
    }
    /**
     * Find object in array by value of a property
     * @param {Array} arrayData
     * @param {string} propertyName
     * @param {string} propertyValue
     */
    valuePipeFind(arrayData, propertyName, propertyValue) {
        if (Array.isArray(arrayData) && propertyName && propertyName) {
            // noinspection EqualityComparisonWithCoercionJS
            return arrayData.find(item => item && item[propertyName] == propertyValue);
        }
        return null;
    }
    /**
     * Find object in array by value of a property
     * @param {Array} data
     * @param {string} propertyName
     */
    valuePipeGet(data, propertyName) {
        return data && propertyName && data[propertyName] || null;
    }
    /**
     * @param dataArray
     * @param propertyName
     * @param propertyValue
     */
    blockPipeFilter(dataArray, propertyName, propertyValue) {
        if (Array.isArray(dataArray) && propertyName) {
            if (propertyValue) {
                return dataArray.filter(item => typeof item === "object" && item[propertyName] === propertyValue);
            }
            return dataArray.filter(item => typeof item === "object" &&
                item.hasOwnProperty(propertyName) && item[propertyName]);
        }
        return dataArray;
    }
    /**
     * @param {Cell} cell
     * @param {object[]} dataArray
     * @param {number} countRows
     * @return {number} count of inserted rows
     */
    blockPipeRepeatRows(cell, dataArray, countRows) {
        if (!Array.isArray(dataArray) || !dataArray.length) {
            console.warn('TemplateEngine.blockPipeRepeatRows', cell.address, 'The data must be not empty array, but got:', dataArray);
            return 0;
        }
        countRows = +countRows > 0 ? +countRows : 1;
        const startRow = cell.row;
        const endRow = startRow + countRows - 1;
        if (dataArray.length > 1) {
            this.wsh.cloneRows(startRow, endRow, dataArray.length - 1);
        }
        const wsDimension = this.wsh.getSheetDimension();
        let sectionRange = new CellRange(startRow, wsDimension.left, endRow, wsDimension.right);
        dataArray.forEach(data => {
            sectionRange = this.processBlocks(sectionRange, data);
            this.processValues(sectionRange, data);
            sectionRange.move(countRows, 0);
        });
        return (dataArray.length - 1) * countRows;
    }
    /**
     *
     * @param {Cell} cell
     * @param {object[]} dataArray
     * @param {number} blockRows the number rows of the block
     * @param {number} blockColumns the number rows of the block
     * @param {number} tileColumns the number columns to repeat the block
     * @return {number} count of inserted rows
     */
    blockPipeTile(cell, dataArray, blockRows, blockColumns, tileColumns) {
        // return;
        if (!Array.isArray(dataArray) || !dataArray.length) {
            console.warn('TemplateEngine.blockPipeTile', cell.address, 'The data must be not empty array, but got:', dataArray);
            return 0;
        }
        blockRows = +blockRows > 0 ? +blockRows : 1;
        blockColumns = +blockColumns > 0 ? +blockColumns : 1;
        tileColumns = +tileColumns > 0 ? +tileColumns : 1;
        const blockRange = new CellRange(cell.row, cell.col, cell.row + blockRows - 1, cell.col + blockColumns - 1);
        const cloneRowsCount = Math.ceil(dataArray.length / tileColumns) - 1;
        if (dataArray.length > tileColumns) {
            this.wsh.cloneRows(blockRange.top, blockRange.bottom, cloneRowsCount);
        }
        let tileColumn = 1, tileRange = CellRange.createFromRange(blockRange);
        dataArray.forEach((data, idx, array) => {
            // Prepare the next tile
            if ((idx !== array.length - 1) && (tileColumn + 1 <= tileColumns)) {
                const nextTileRange = CellRange.createFromRange(tileRange);
                nextTileRange.move(0, tileRange.countColumns);
                this.wsh.copyCellRange(tileRange, nextTileRange);
            }
            // Process templates
            tileRange = this.processBlocks(tileRange, data);
            this.processValues(tileRange, data);
            // Move tiles
            if (idx !== array.length - 1) {
                tileColumn++;
                if (tileColumn <= tileColumns) {
                    tileRange.move(0, tileRange.countColumns);
                }
                else {
                    tileColumn = 1;
                    blockRange.move(tileRange.countRows, 0);
                    tileRange = CellRange.createFromRange(blockRange);
                }
            }
        });
        return cloneRowsCount * blockRange.countRows;
    }
}
module.exports.TemplateEngine = TemplateEngine;