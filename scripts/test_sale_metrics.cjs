const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync('src/app/utils/saleMetrics.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const context = { exports: {} };
vm.runInNewContext(compiled, context);
const { saleNetTotal, saleNetRevenue, saleCost, returnedUnits, csvCell } = context.exports;
const sale = {
  status: 'completed', subtotal: 300, lineDiscount: 30, globalDiscount: 27, totalPrice: 289.17,
  returnedTotal: 96.39, items: [{ id: 1, quantity: 3, unitCost: 40 }],
  returns: [{ items: [{ itemId: 1, quantity: 1, restock: true }] }],
};
assert.equal(saleNetTotal(sale), 192.78);
assert.equal(saleNetRevenue(sale), 162); // 19% tax, line and global discounts.
assert.equal(saleCost(sale), 80);
assert.equal(returnedUnits(sale, sale.items[0]), 1);
sale.returns[0].items[0].restock = false;
assert.equal(saleCost(sale), 120); // Damaged stock retains its cost.
sale.returnedTotal = 289.17;
assert.equal(saleNetRevenue(sale), 0);
assert.equal(saleCost(sale), 120);
sale.status = 'cancelled';
assert.equal(saleNetTotal(sale), 0);
assert.equal(saleCost(sale), 0);
assert.equal(saleNetRevenue({ ...sale, status: 'pending' }), 0);
assert.equal(saleNetTotal({ ...sale, status: 'completed', returns: undefined, returnedTotal: undefined }), 289.17);
assert.equal(csvCell('=HYPERLINK("example")'), '"\'=HYPERLINK(""example"")"');
assert.equal(csvCell(' +1'), '"\' +1"');
assert.equal(csvCell(-100), '"-100"');
assert.equal(csvCell('Ana; Pérez'), '"Ana; Pérez"');
console.log('OK: refunds, tax/discount allocation, damaged goods cost, cancelled sales and safe CSV cells');
