/**
 * Payment / advance calculation tests for SWISSA REPAIR PRO.
 * Run: npx tsx scripts/test-payment-calcs.ts
 */
import {
  formatWhatsAppPaymentSummary,
  formatWhatsAppRemainingPaymentSummary,
} from '../src/constants';
import {
  allocateAdvanceAcrossItems,
  allocatePaymentAcrossItems,
  getItemBalance,
  getItemDisplayStatus,
  getItemTotalPaidForItem,
  getJobPaymentBreakdown,
  getOverallJobPaymentSummaryAfterDelivery,
  getRemainingItemsPaymentSummary,
  getSelectedDeliveryPaymentSummary,
  isItemReadyUndelivered,
} from '../src/types';

type Item = {
  id: string;
  finalAmount: number;
  estimatedAmount?: number;
  amountPaid: number;
  advanceApplied: number;
  refundAmount?: number;
  status?: string;
  delivered?: boolean;
};

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
}

function almost(a: number, b: number, eps = 0.001) {
  return Math.abs(a - b) <= eps;
}

function item(partial: Partial<Item> & { id: string; finalAmount: number }): Item {
  return {
    amountPaid: 0,
    advanceApplied: 0,
    status: 'Ready',
    delivered: false,
    ...partial,
  };
}

console.log('\n=== 1. Advance completely used in first partial delivery ===');
{
  // Job ₹1250: Item A ₹250, Item B ₹500, Item C ₹500. Advance ₹250.
  // Deliver A (₹250) — advance covers fully, cash ₹0.
  const items = [
    item({ id: 'a', finalAmount: 250, status: 'Ready' }),
    item({ id: 'b', finalAmount: 500, status: 'Ready' }),
    item({ id: 'c', finalAmount: 500, status: 'Ready' }),
  ];
  const live = getSelectedDeliveryPaymentSummary([items[0]], items, 250, 0);
  assert(almost(live.advanceAppliedThisDelivery, 250), 'advance applied this delivery = ₹250');
  assert(almost(live.dueAfterAdvance, 0), 'due after advance = ₹0');
  assert(almost(live.balanceAfterPayment, 0), 'delivered balance = ₹0');
  assert(live.canConfirm, 'can confirm with advance only');

  const advMap = allocateAdvanceAcrossItems([items[0]], live.advanceAppliedThisDelivery);
  const payMap = allocatePaymentAcrossItems(
    [{ ...items[0], amountPaid: 250 }], // fully covered by advance → no cash due
    0,
  );
  // Simulate after save
  const after = [
    { ...items[0], amountPaid: 0, advanceApplied: advMap.get('a') || 0, delivered: true, status: 'Delivered' },
    items[1],
    items[2],
  ];
  const breakdown = getJobPaymentBreakdown(after, 250);
  assert(almost(breakdown.originalAdvancePaid, 250), 'original advance still ₹250');
  assert(almost(breakdown.advanceAppliedTotal, 250), 'advance already used ₹250');
  assert(almost(breakdown.remainingAdvanceBalance, 0), 'remaining advance ₹0');
  assert(almost(breakdown.deliveryCashPaymentsTotal, 0), 'delivery cash ₹0');
  assert(almost(breakdown.totalPaid, 250), 'total paid = original advance only (not double)');
  assert(almost(breakdown.balancePayable, 1000), 'balance payable ₹1000');
}

console.log('\n=== 2. Second partial delivery with no advance remaining ===');
{
  const items = [
    item({ id: 'a', finalAmount: 250, amountPaid: 0, advanceApplied: 250, delivered: true, status: 'Delivered' }),
    item({ id: 'b', finalAmount: 500, status: 'Ready' }),
    item({ id: 'c', finalAmount: 500, status: 'Ready' }),
  ];
  const live = getSelectedDeliveryPaymentSummary([items[1]], items, 250, 500);
  assert(almost(live.unallocatedAdvance, 0), 'no advance remaining');
  assert(almost(live.advanceAppliedThisDelivery, 0), 'advance applied now = ₹0');
  assert(almost(live.dueAfterAdvance, 500), 'due after advance = ₹500');
  assert(almost(live.balanceAfterPayment, 0), 'full cash payment → delivered balance ₹0');
  assert(live.canConfirm, 'can confirm');

  const advMap = allocateAdvanceAcrossItems([items[1]], 0);
  const payMap = new Map([['b', 500]]);
  const overall = getOverallJobPaymentSummaryAfterDelivery(
    items,
    250,
    new Set(['b']),
    payMap,
    advMap,
  );
  assert(almost(overall.originalAdvancePaid, 250), 'original advance ₹250');
  assert(almost(overall.advanceAppliedTotal, 250), 'advance already used still ₹250');
  assert(almost(overall.remainingAdvanceBalance, 0), 'advance balance ₹0');
  assert(almost(overall.deliveryCashPaymentsTotal, 500), 'delivery cash ₹500');
  assert(almost(overall.totalPaid, 750), 'total paid ₹750 (250+500, advance NOT double-counted)');
  assert(almost(overall.balancePayable, 500), 'balance payable ₹500');
}

console.log('\n=== 3. Full current payment → delivered balance ₹0 ===');
{
  const items = [
    item({ id: 'a', finalAmount: 250, advanceApplied: 250, delivered: true, status: 'Delivered' }),
    item({ id: 'b', finalAmount: 500, status: 'Ready' }),
  ];
  const live = getSelectedDeliveryPaymentSummary([items[1]], items, 250, 500);
  assert(almost(live.balanceAfterPayment, 0), 'delivered items balance ₹0 when fully paid');
  assert(live.canConfirm, 'can confirm when fully paid');
}

console.log('\n=== 4. Advance is not double-counted in total paid ===');
{
  // After first delivery used all ₹250 advance + ₹500 cash on another item
  const items = [
    item({ id: 'a', finalAmount: 250, advanceApplied: 250, delivered: true, status: 'Delivered' }),
    item({ id: 'b', finalAmount: 500, amountPaid: 500, delivered: true, status: 'Delivered' }),
    item({ id: 'c', finalAmount: 500, status: 'Ready' }),
  ];
  const b = getJobPaymentBreakdown(items, 250);
  assert(almost(b.totalPaid, 750), 'totalPaid = 250+500 = 750');
  assert(
    !almost(b.totalPaid, 250 + 250 + 500),
    'totalPaid must NOT equal original+applied+cash (double-count)',
  );
  assert(almost(b.advanceAppliedTotal, 250), 'applied tracked separately');
  assert(almost(b.remainingAdvanceBalance, 0), 'remaining ₹0');
}

console.log('\n=== 5. Multiple partial deliveries ===');
{
  let items: Item[] = [
    item({ id: 'a', finalAmount: 250 }),
    item({ id: 'b', finalAmount: 500 }),
    item({ id: 'c', finalAmount: 500 }),
  ];
  const advance = 250;

  // Delivery 1: A with advance
  let live = getSelectedDeliveryPaymentSummary([items[0]], items, advance, 0);
  let advMap = allocateAdvanceAcrossItems([items[0]], live.advanceAppliedThisDelivery);
  items = [
    { ...items[0], advanceApplied: advMap.get('a') || 0, delivered: true, status: 'Delivered' },
    items[1],
    items[2],
  ];
  let b = getJobPaymentBreakdown(items, advance);
  assert(almost(b.remainingAdvanceBalance, 0), 'after D1: advance balance ₹0');
  assert(almost(b.totalPaid, 250), 'after D1: total paid ₹250');

  // Delivery 2: B with ₹500 cash
  live = getSelectedDeliveryPaymentSummary([items[1]], items, advance, 500);
  assert(almost(live.advanceAppliedThisDelivery, 0), 'after D1: no advance for D2');
  items = [
    items[0],
    { ...items[1], amountPaid: 500, delivered: true, status: 'Delivered' },
    items[2],
  ];
  b = getJobPaymentBreakdown(items, advance);
  assert(almost(b.deliveryCashPaymentsTotal, 500), 'after D2: cash ₹500');
  assert(almost(b.totalPaid, 750), 'after D2: total paid ₹750');
  assert(almost(b.balancePayable, 500), 'after D2: balance ₹500');
}

console.log('\n=== 6. Final job delivery ===');
{
  const items = [
    item({ id: 'a', finalAmount: 250, advanceApplied: 250, delivered: true, status: 'Delivered' }),
    item({ id: 'b', finalAmount: 500, amountPaid: 500, delivered: true, status: 'Delivered' }),
    item({ id: 'c', finalAmount: 500, status: 'Ready' }),
  ];
  const live = getSelectedDeliveryPaymentSummary([items[2]], items, 250, 500);
  assert(live.canConfirm && almost(live.balanceAfterPayment, 0), 'final delivery fully payable');
  const overall = getOverallJobPaymentSummaryAfterDelivery(
    items,
    250,
    new Set(['c']),
    new Map([['c', 500]]),
    new Map([['c', 0]]),
  );
  assert(almost(overall.totalPaid, 1250), 'after final: total paid ₹1250');
  assert(almost(overall.balancePayable, 0), 'after final: balance ₹0');
  assert(almost(overall.remainingAdvanceBalance, 0), 'after final: advance balance ₹0');
}

console.log('\n=== 7. Re-applying same delivery numbers is idempotent (no duplicate) ===');
{
  // markItemDelivered uses absolute SET — simulating two writes with same values
  const items = [
    item({ id: 'a', finalAmount: 250, amountPaid: 0, advanceApplied: 250, delivered: true, status: 'Delivered' }),
    item({ id: 'b', finalAmount: 500, amountPaid: 500, delivered: true, status: 'Delivered' }),
    item({ id: 'c', finalAmount: 500 }),
  ];
  const first = getJobPaymentBreakdown(items, 250);
  // "Re-save" same absolute values
  const again = getJobPaymentBreakdown(
    [
      { ...items[0], amountPaid: 0, advanceApplied: 250 },
      { ...items[1], amountPaid: 500, advanceApplied: 0 },
      items[2],
    ],
    250,
  );
  assert(almost(first.totalPaid, again.totalPaid), 're-save same values → same totalPaid');
  assert(almost(first.deliveryCashPaymentsTotal, again.deliveryCashPaymentsTotal), 'cash not duplicated');
  assert(almost(first.advanceAppliedTotal, again.advanceAppliedTotal), 'advance applied not duplicated');
}

console.log('\n=== 8. Double confirm with same inputs does not invent extra payment ===');
{
  const items = [
    item({ id: 'a', finalAmount: 250, advanceApplied: 250, delivered: true, status: 'Delivered' }),
    item({ id: 'b', finalAmount: 500 }),
    item({ id: 'c', finalAmount: 500 }),
  ];
  const payMap = new Map([['b', 500]]);
  const advMap = new Map([['b', 0]]);
  const once = getOverallJobPaymentSummaryAfterDelivery(items, 250, new Set(['b']), payMap, advMap);
  const twice = getOverallJobPaymentSummaryAfterDelivery(items, 250, new Set(['b']), payMap, advMap);
  assert(almost(once.totalPaid, twice.totalPaid), 'repeated summary call is stable');
  assert(almost(once.totalPaid, 750), 'expected total paid ₹750');
  assert(almost(once.deliveryCashPaymentsTotal, 500), 'cash still ₹500 (not ₹1000)');
}

console.log('\n=== Example (user scenario) ===');
{
  // Job total ₹1,250 | Original advance ₹250 | Advance used ₹250 | Delivery cash ₹500
  const items = [
    item({ id: 'a', finalAmount: 250, advanceApplied: 250, delivered: true, status: 'Delivered' }),
    item({ id: 'b', finalAmount: 500, amountPaid: 500, delivered: true, status: 'Delivered' }),
    item({ id: 'c', finalAmount: 500, status: 'Ready' }),
  ];
  const b = getJobPaymentBreakdown(items, 250);
  console.log(`  Job total                 ₹${b.jobTotal}`);
  console.log(`  Original advance          ₹${b.originalAdvancePaid}`);
  console.log(`  Advance already used      ₹${b.advanceAppliedTotal}`);
  console.log(`  Remaining advance         ₹${b.remainingAdvanceBalance}`);
  console.log(`  Delivery cash payments    ₹${b.deliveryCashPaymentsTotal}`);
  console.log(`  Total paid                ₹${b.totalPaid}`);
  console.log(`  Balance payable           ₹${b.balancePayable}`);
  assert(almost(b.remainingAdvanceBalance, 0), 'Expected remaining advance ₹0');
  assert(almost(b.totalPaid, 750), 'Expected total paid ₹750');
  assert(almost(b.balancePayable, 500), 'Expected balance payable ₹500');
}

console.log('\n=== 9. READY remaining summary — user example (₹870 → ₹600 left) ===');
{
  // Original job ₹870: Item A ₹270 delivered (settled), Item B ₹600 still Ready.
  // Advance/payments already fully consumed by first item → paid towards remaining ₹0.
  const items = [
    item({ id: 'a', finalAmount: 270, amountPaid: 0, advanceApplied: 270, delivered: true, status: 'Delivered' }),
    item({ id: 'b', finalAmount: 600, status: 'Ready' }),
  ];
  const rem = getRemainingItemsPaymentSummary(items, 270);
  assert(almost(rem.originalJobTotal, 870), 'original job total preserved ₹870');
  assert(rem.hasPartialDelivery, 'hasPartialDelivery after first delivery');
  assert(almost(rem.remainingItemsTotal, 600), 'remaining items total ₹600');
  assert(almost(rem.valueSettledAgainstDeliveredItems, 270), 'settled against delivered ₹270');
  assert(almost(rem.paidTowardsRemaining, 0), 'paid towards remaining ₹0');
  assert(almost(rem.remainingItemsBalance, 600), 'remaining balance ₹600');

  const wa = formatWhatsAppRemainingPaymentSummary(
    rem.remainingItemsTotal,
    rem.paidTowardsRemaining,
    rem.remainingItemsBalance,
  );
  assert(wa.includes('REMAINING ITEMS TOTAL'), 'READY WA uses remaining-items labels');
  assert(wa.includes('PAID TOWARDS REMAINING'), 'READY WA shows paid towards remaining');
  assert(!wa.includes('TOTAL AMOUNT'), 'READY WA must not show full-job TOTAL AMOUNT after partial');
}

console.log('\n=== 10. Before any partial delivery — full-job READY summary ===');
{
  const items = [
    item({ id: 'a', finalAmount: 270, status: 'Ready' }),
    item({ id: 'b', finalAmount: 600, status: 'Ready' }),
  ];
  const rem = getRemainingItemsPaymentSummary(items, 270);
  assert(!rem.hasPartialDelivery, 'no partial delivery yet');
  const full = getJobPaymentBreakdown(items, 270);
  const wa = formatWhatsAppPaymentSummary(full.jobTotal, full.totalPaid, full.balancePayable);
  assert(wa.includes('TOTAL AMOUNT'), 'pre-delivery READY uses full-job TOTAL AMOUNT');
  assert(almost(full.jobTotal, 870), 'full job total ₹870');
  assert(almost(full.balancePayable, 600), 'full balance after advance ₹600');
}

console.log('\n=== 11. Two-item job — first delivered, second marked Ready ===');
{
  const items = [
    item({ id: 'a', finalAmount: 270, amountPaid: 270, delivered: true, status: 'Delivered' }),
    item({ id: 'b', finalAmount: 600, status: 'Ready' }),
  ];
  const rem = getRemainingItemsPaymentSummary(items, 0);
  assert(almost(rem.remainingItemsTotal, 600), 'only undelivered Ready item in remaining total');
  assert(almost(rem.remainingItemsBalance, 600), 'balance for Ready item ₹600');
}

console.log('\n=== 12. Advance fully used by first item ===');
{
  const items = [
    item({ id: 'a', finalAmount: 300, advanceApplied: 300, delivered: true, status: 'Delivered' }),
    item({ id: 'b', finalAmount: 400, status: 'Ready' }),
    item({ id: 'c', finalAmount: 200, status: 'Received' }),
  ];
  const rem = getRemainingItemsPaymentSummary(items, 300);
  assert(almost(rem.paymentsAvailableForRemainingItems, 0), 'no advance left for remaining');
  assert(almost(rem.paidTowardsRemaining, 0), 'paid towards remaining ₹0');
  assert(almost(rem.remainingItemsTotal, 600), 'Ready + Received still in remaining (₹400+₹200)');
  assert(almost(rem.remainingItemsBalance, 600), 'remaining balance ₹600');
}

console.log('\n=== 13. Advance partly remaining after first delivery ===');
{
  // Advance ₹500, first item ₹200 settled with ₹200 advance → ₹300 still available for remaining ₹700.
  const items = [
    item({ id: 'a', finalAmount: 200, advanceApplied: 200, delivered: true, status: 'Delivered' }),
    item({ id: 'b', finalAmount: 400, status: 'Ready' }),
    item({ id: 'c', finalAmount: 300, status: 'Received' }),
  ];
  const rem = getRemainingItemsPaymentSummary(items, 500);
  assert(almost(rem.valueSettledAgainstDeliveredItems, 200), 'settled ₹200');
  assert(almost(rem.totalJobPaymentsReceived, 500), 'total payments received = advance ₹500');
  assert(almost(rem.paymentsAvailableForRemainingItems, 300), '₹300 still available for remaining');
  assert(almost(rem.paidTowardsRemaining, 300), 'paid towards remaining capped at available ₹300');
  assert(almost(rem.remainingItemsTotal, 700), 'remaining total ₹700');
  assert(almost(rem.remainingItemsBalance, 400), 'remaining balance ₹400');
}

console.log('\n=== 14. Multiple partial deliveries — READY after second delivery ===');
{
  const items = [
    item({ id: 'a', finalAmount: 250, advanceApplied: 250, delivered: true, status: 'Delivered' }),
    item({ id: 'b', finalAmount: 500, amountPaid: 500, delivered: true, status: 'Delivered' }),
    item({ id: 'c', finalAmount: 500, status: 'Ready' }),
  ];
  const rem = getRemainingItemsPaymentSummary(items, 250);
  assert(almost(rem.remainingItemsTotal, 500), 'after 2 deliveries: remaining ₹500');
  assert(almost(rem.valueSettledAgainstDeliveredItems, 750), 'settled 250+500 = ₹750');
  assert(almost(rem.totalJobPaymentsReceived, 750), 'payments received ₹750');
  assert(almost(rem.paidTowardsRemaining, 0), 'nothing left for remaining item');
  assert(almost(rem.remainingItemsBalance, 500), 'remaining balance ₹500');
  assert(almost(rem.originalJobTotal, 1250), 'original job total still ₹1250');
}

console.log('\n=== 15. Cancelled remaining item excluded from remaining total ===');
{
  const items = [
    item({ id: 'a', finalAmount: 270, advanceApplied: 270, delivered: true, status: 'Delivered' }),
    item({ id: 'b', finalAmount: 400, status: 'Ready' }),
    item({ id: 'c', finalAmount: 200, status: 'Cancelled' }),
  ];
  const rem = getRemainingItemsPaymentSummary(items, 270);
  assert(almost(rem.remainingItemsTotal, 400), 'cancelled ₹200 excluded; remaining ₹400');
  assert(almost(rem.remainingItemsBalance, 400), 'balance ignores cancelled item');
}

console.log('\n=== 16. Final delivery — remaining total ₹0, full job balance ₹0 ===');
{
  const beforeFinal = [
    item({ id: 'a', finalAmount: 270, advanceApplied: 270, delivered: true, status: 'Delivered' }),
    item({ id: 'b', finalAmount: 600, status: 'Ready' }),
  ];
  const overall = getOverallJobPaymentSummaryAfterDelivery(
    beforeFinal,
    270,
    new Set(['b']),
    new Map([['b', 600]]),
    new Map([['b', 0]]),
  );
  assert(almost(overall.balancePayable, 0), 'final delivery overall balance ₹0');
  assert(almost(overall.totalPaid, 870), 'final delivery total paid ₹870');

  const afterFinal = [
    beforeFinal[0],
    { ...beforeFinal[1], amountPaid: 600, delivered: true, status: 'Delivered' },
  ];
  const rem = getRemainingItemsPaymentSummary(afterFinal, 270);
  assert(almost(rem.remainingItemsTotal, 0), 'after final: remaining items total ₹0');
  assert(almost(rem.remainingItemsBalance, 0), 'after final: remaining balance ₹0');
  assert(almost(rem.originalJobTotal, 870), 'original job total still available');
}

console.log('\n=== 17. Resending Ready does not alter accounting (read-only) ===');
{
  const items = [
    item({ id: 'a', finalAmount: 270, advanceApplied: 270, delivered: true, status: 'Delivered' }),
    item({ id: 'b', finalAmount: 600, status: 'Ready' }),
  ];
  const first = getRemainingItemsPaymentSummary(items, 270);
  const second = getRemainingItemsPaymentSummary(items, 270);
  assert(almost(first.remainingItemsTotal, second.remainingItemsTotal), 'resend: same remaining total');
  assert(almost(first.paidTowardsRemaining, second.paidTowardsRemaining), 'resend: same paid towards remaining');
  assert(almost(first.remainingItemsBalance, second.remainingItemsBalance), 'resend: same balance');
  assert(almost(first.valueSettledAgainstDeliveredItems, second.valueSettledAgainstDeliveredItems), 'resend: settled unchanged');
  // Items unchanged — no mutation
  assert(items[0].advanceApplied === 270 && items[0].amountPaid === 0, 'delivered item amounts not rewritten');
  assert(items[1].amountPaid === 0 && items[1].advanceApplied === 0, 'ready item amounts not rewritten');
}

console.log('\n=== 18. Item settled paid/balance includes advance ===');
{
  const delivered = item({
    id: 'a',
    finalAmount: 270,
    amountPaid: 0,
    advanceApplied: 270,
    delivered: true,
    status: 'Delivered',
  });
  assert(almost(getItemTotalPaidForItem(delivered), 270), 'total paid for item = cash+advance ₹270');
  assert(almost(getItemBalance(delivered), 0), 'item balance ₹0 when fully settled by advance');
  assert(getItemDisplayStatus(delivered) === 'Delivered', 'display status Delivered');
}

console.log('\n=== 19. Two items delivered together (Watch ₹1000 + Spectacle ₹5000) ===');
{
  const items = [
    item({ id: 'watch', finalAmount: 1000, status: 'Ready' }),
    item({ id: 'spectacle', finalAmount: 5000, status: 'Ready' }),
  ];
  const advance = 100;
  const paymentNow = 5900;
  const live = getSelectedDeliveryPaymentSummary(items, items, advance, paymentNow);
  assert(almost(live.advanceAppliedThisDelivery, 100), 'advance applied now ₹100');
  assert(almost(live.dueAfterAdvance, 5900), 'due after advance ₹5900');
  assert(live.canConfirm, 'can confirm full settlement');

  const advanceMap = allocateAdvanceAcrossItems(items, live.advanceAppliedThisDelivery);
  const afterAdv = items.map(i => ({
    ...i,
    advanceApplied: (advanceMap.get(i.id) || 0),
  }));
  const paymentMap = allocatePaymentAcrossItems(afterAdv, paymentNow);

  assert(almost(advanceMap.get('watch') || 0, 100), 'Watch advance ₹100');
  assert(almost(advanceMap.get('spectacle') || 0, 0), 'Spectacle advance ₹0');
  assert(almost(paymentMap.get('watch') || 0, 900), 'Watch delivery payment ₹900');
  assert(almost(paymentMap.get('spectacle') || 0, 5000), 'Spectacle delivery payment ₹5000');

  const after = [
    {
      ...items[0],
      amountPaid: paymentMap.get('watch') || 0,
      advanceApplied: advanceMap.get('watch') || 0,
      delivered: true,
      status: 'Delivered',
    },
    {
      ...items[1],
      amountPaid: paymentMap.get('spectacle') || 0,
      advanceApplied: advanceMap.get('spectacle') || 0,
      delivered: true,
      status: 'Delivered',
    },
  ];

  assert(getItemDisplayStatus(after[0]) === 'Delivered', 'Watch status DELIVERED');
  assert(getItemDisplayStatus(after[1]) === 'Delivered', 'Spectacle status DELIVERED');
  assert(almost(getItemTotalPaidForItem(after[0]), 1000), 'Watch total paid ₹1000');
  assert(almost(getItemBalance(after[0]), 0), 'Watch balance ₹0');
  assert(almost(getItemTotalPaidForItem(after[1]), 5000), 'Spectacle total paid ₹5000');
  assert(almost(getItemBalance(after[1]), 0), 'Spectacle balance ₹0');
  assert(!isItemReadyUndelivered(after[0]) && !isItemReadyUndelivered(after[1]), 'neither remains READY');

  const b = getJobPaymentBreakdown(after, advance);
  assert(almost(b.originalAdvancePaid, 100), 'Original advance ₹100');
  assert(almost(b.deliveryCashPaymentsTotal, 5900), 'Delivery payments ₹5900');
  assert(almost(b.totalPaid, 6000), 'Total paid ₹6000');
  assert(almost(b.balancePayable, 0), 'Job balance ₹0');

  console.log('  Watch → DELIVERED | advance ₹100 + cash ₹900 | paid ₹1000 | balance ₹0');
  console.log('  Spectacle → DELIVERED | cash ₹5000 | paid ₹5000 | balance ₹0');
  console.log(`  Job: advance ₹${b.originalAdvancePaid} + delivery ₹${b.deliveryCashPaymentsTotal} = total ₹${b.totalPaid}`);
}

console.log('\n=== 20. Double-submit same delivery allocation is stable ===');
{
  const items = [
    item({ id: 'watch', finalAmount: 1000, amountPaid: 900, advanceApplied: 100, delivered: true, status: 'Delivered' }),
    item({ id: 'spectacle', finalAmount: 5000, amountPaid: 5000, delivered: true, status: 'Delivered' }),
  ];
  const first = getJobPaymentBreakdown(items, 100);
  const again = getJobPaymentBreakdown(
    items.map(i => ({ ...i })), // same absolute values
    100,
  );
  assert(almost(first.totalPaid, again.totalPaid), 'idempotent totals');
  assert(almost(first.deliveryCashPaymentsTotal, 5900), 'cash not doubled');
}

console.log('\n=== 21. Item 1 ₹800 READY → DELIVERED with full payment ===');
{
  const items = [
    item({ id: 'item1', finalAmount: 800, status: 'Ready' }),
    item({ id: 'item2', finalAmount: 600, status: 'Ready' }),
  ];
  const advance = 0;
  const paymentNow = 800;
  const selected = [items[0]];
  const live = getSelectedDeliveryPaymentSummary(selected, items, advance, paymentNow);
  assert(live.canConfirm, 'Item 1 can confirm with ₹800');
  const advanceMap = allocateAdvanceAcrossItems(selected, live.advanceAppliedThisDelivery);
  const afterAdv = selected.map(i => ({
    ...i,
    advanceApplied: advanceMap.get(i.id) || 0,
  }));
  const paymentMap = allocatePaymentAcrossItems(afterAdv, paymentNow);
  const amountPaid = paymentMap.get('item1') || 0;
  const advanceApplied = advanceMap.get('item1') || 0;
  const delivered = {
    ...items[0],
    amountPaid,
    advanceApplied,
    delivered: true,
    status: 'Delivered',
  };
  const afterJob = [delivered, items[1]];
  assert(getItemDisplayStatus(delivered) === 'Delivered', 'Item 1 status DELIVERED');
  assert(almost(getItemTotalPaidForItem(delivered), 800), 'Item 1 totalPaidForItem ₹800');
  assert(almost(getItemBalance(delivered), 0), 'Item 1 balance ₹0');
  assert(!isItemReadyUndelivered(delivered), 'Item 1 removed from Ready');
  const b = getJobPaymentBreakdown(afterJob, advance);
  assert(almost(b.deliveryCashPaymentsTotal, 800), 'delivery payments ₹800');
  assert(almost(b.totalPaid, 800), 'total paid ₹800');
  assert(almost(b.balancePayable, 600), 'job balance reduced to remaining ₹600');
  console.log('  Item 1 → DELIVERED | paid ₹800 | balance ₹0');
  console.log(`  Job delivery payments ₹${b.deliveryCashPaymentsTotal}, balance ₹${b.balancePayable}`);
}

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('All payment tests passed.\n');
