// Food Bank Manager – Friends of Isaac's Food Bank
// Version and fixed data. Bump APP_VERSION and add to VERSION_HISTORY every release.
export const APP_VERSION = '1.3';

export const VERSION_HISTORY = [
  ['1.3', '24 Nov 2026', [
    'Users are now set up by Simon in Setup › Users (name and default food bank). A Food Bank Manager picks their name from a list instead of typing it, and starts on their default food bank.',
    "If Simon doesn't accept a request, it goes back to the person who sent it: a red number on the tab, a red bar at the top and a message. Shopping and donation lists show in the Food Bank tab, highlighted with Simon's note – \"Change it and send again\" or \"OK, remove\". Stock takes show at the top of the Stock Take tab – \"Count again\" fills in the last counts.",
    'Shopping lists: new 🎤 button – read the list out (e.g. "10 beans, 6 pasta") and it fills it in. Anything it isn\'t sure of is highlighted yellow and must be checked before Submit. A bar at the bottom shows what it is hearing while you scroll.',
    'New item list when you type an item: bigger, easier to tap on a phone, and finds items from any word in the name.',
    'Food Bank Managers can only choose items from the list – no new item names.',
    'The Emergency tab is now called Contacts.',
    "Tapping the logo opens the Friends of Isaac's Food Bank website.",
    'The "Suggest a feature" box has been removed (requests now come through the next-version list).',
  ]],
  ['1.2', '24 Nov 2026', [
    'Food Bank Manager: your food bank is shown at the top of every screen, with Change.',
    'Food Bank Manager: the Donation button is gone from inside lists – use "+ New donation list". New "Show / hide completed lists" button.',
    'Food Bank Manager: new Stock Take tab – count any location (storage or any food bank) and Send to Simon for approval.',
    'Food Bank Manager: new History tab – choose any food bank to see all its bookings.',
    'New Report tab (both views): for a food bank and dates – received, donated, given out, booked out and in stock now, item by item.',
    'New Emergency tab (both views): emergency contacts, edited by Simon in Setup.',
    "Simon: Requests now include stock takes (yellow); donations are purple; tap a decided request to see it in full and Reopen it to edit and accept again (anything it booked is undone first).",
    "Simon: his own stock takes are still booked straight away, no request.",
    'Simon: Setup › Locations has a Default person for each location, chosen from the people who use the app. New Setup › Users list.',
    'Simon: Stock table can be sorted up or down by Item, each storage location or Total.',
    'History for one location now loads all its bookings, not just the latest 60.',
  ]],
  ['1.1', '24 Nov 2026', [
    'Choose Simon or Food Bank Manager when the app opens (for testing – logins will replace this). "Switch view" at the top.',
    "Simon's view: Stock now shows storage only (Main Storage, Container and any storage containers added with '+ Add storage container').",
    "Simon's view: new Requests tab – review shopping lists and donations from the food banks, change quantities, Accept (books the stock) or Don't accept with a note.",
    "Food Bank Manager's view: Food Bank tab with shopping lists on lined paper – From (storage) and To (your food bank), items and quantities, saves as you type, Save, Submit.",
    'Submitted lists stay visible, greyed out and crossed through, with what Simon decided.',
    'Donation button: marks a list as a direct donation (purple). When accepted, the items are booked in to the new "Donation" location and straight on to the food bank.',
    'Suggest a feature now takes up to 10,000 characters (was 2,000).',
    'Delivery list says "1 item" instead of "1 items".',
  ]],
  ['1.0', '23 Nov 2026', [
    'First version of Food Bank Manager (web app).',
    'Stock: live stock for every location – Main Storage, Container and each food bank – with search and totals.',
    'Book In: donations and purchases, with donor names remembered.',
    'Transfer: move stock from Main Storage to a food bank, then share or print a delivery list for the food bank.',
    'Stock Take: count a location and the app books the differences.',
    'Book Out: damaged, out of date, short dated or given out.',
    'History: every booking, with undo.',
    'Setup: items and locations; your name is recorded on each booking.',
    'Starting data imported from "Inventory Latest.xlsx" (1 Apr 2024 – 19 Jun 2026).',
  ]],
];

// Default details for each location, used when the location list is first created.
// Food bank names and addresses from teamisaac.org.uk – matched to the spreadsheet's location names.
export const DEFAULT_LOCATIONS = [
  { n: 'Main Storage', kind: 'store', site: 'Main storage', addr: '' },
  { n: 'Container', kind: 'store', site: 'Storage container', addr: '' },
  { n: 'Greenland', kind: 'bank', site: "Isaac's Place", addr: '51 Throckmorton Road, Redditch, B98 7RP' },
  { n: 'Batchley', kind: 'bank', site: "Samuel's Place", addr: '1 Batchley Road, Batchley, Redditch, B97 6HX' },
  { n: 'Abbeydale', kind: 'bank', site: "Russell's Retreat", addr: 'Abbeydale Social Club, Woodfield Close, Redditch, B98 8JE' },
  { n: 'Moons Moat', kind: 'bank', site: "Frank's site", addr: 'Antolin, Merse Road, Moons Moat North Ind. Estate, B98 9HL' },
  { n: 'Churchill', kind: 'bank', site: 'Willow Trees', addr: 'Loxley Close, Church Hill, Redditch, B98 9JS' },
  { n: 'Woodrow', kind: 'bank', site: 'Micks Mission', addr: 'Bengrove Close, Woodrow, Redditch, B98 7SX' },
  { n: 'Bromsgrove', kind: 'bank', site: 'Bromsgrove', addr: '' },
  { n: 'Free (Short Dated)', kind: 'other', site: 'Free table – short dated', addr: '' },
];

export const TYPES = {
  donation: { label: 'Donation', cls: 'in' },
  purchase: { label: 'Purchased', cls: 'in' },
  opening: { label: 'Initial stock', cls: 'in' },
  transfer: { label: 'Transfer', cls: 'tr' },
  stocktake: { label: 'Stock take', cls: 'st' },
  out: { label: 'Booked out', cls: 'out' },
  other: { label: 'Other', cls: 'st' },
};

export const OUT_REASONS = ['Given out', 'Damaged', 'Out of Date', 'Short Dated', 'Pantry', 'Other'];
