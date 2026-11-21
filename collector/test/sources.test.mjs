// Source-parser fixtures for the Phase 9A fields: contact, photos, and the
// listing texts the signals read. Shapes are modeled on real public pages
// read on 2026-11-21 (EstateSales.net sale 5135811, EstateSales.org sale
// 2461570, a Craigslist Addison posting). EstateSale.com serves this node an
// Incapsula challenge, so its fixture follows the visible-text shapes its
// parser has always relied on; blocked sources stay skipped either way.
// node --test collector/test/*.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {netListing, orgListing} from '../lib/net-org.mjs';
import {craigslistSale, estateSaleCom} from '../lib/com-cl.mjs';

const netPage = seller => {
  const sale = {
    name: 'Tools &amp; Furniture Estate Sale', typeName: 'EstateSales', isPublished: true,
    dates: [{localStartDate: {_value: '2026-11-21T09:00:00.000Z'}, showEndTime: true,
      localEndDate: {_value: '2026-11-21T15:00:00.000Z'}}],
    locationInfo: {showAddress: true, showMap: false},
    schema: {location: {address: {streetAddress: '1210 W Gray St', addressLocality: 'Houston', postalCode: '77005'}}},
    seller, plainTextDescription: 'Tools and furniture throughout the house.',
    pictureCount: 522,
    pictures: [{url: 'https://picturescdn.estatesales.net/999/1-1/aaa.jpg', description: 'Brass figurines'},
      {url: 'https://picturescdn.estatesales.net/999/1-1/bbb.jpg', description: ''}],
  };
  const state = {'feature.traditionalSaleViewState': {entitiesById: {'999': sale}}};
  return `<html><body><p>1210 W Gray St</p><script id="estatesales-net-state">${JSON.stringify({NGRX_STATE: state})}</script></body></html>`;
};

test('EstateSales.net: public phone, website, photo count and captions are captured', () => {
  const record = netListing(netPage({isOrg: true, name: 'Acme Estate Sales', primaryPhone: '(713) 555-0119',
    showPhoneNumber: true, websiteUrl: 'https://acme.example/', pageUrl: '/companies/TX/Houston/77005/42'}),
  'https://www.estatesales.net/TX/Houston/77005/999');
  assert.equal(record.contactPhone, '(713) 555-0119');
  assert.equal(record.contactUrl, 'https://acme.example/');
  assert.equal(record.photoCount, 522);
  assert.deepEqual(record.photoUrls, ['https://picturescdn.estatesales.net/999/1-1/aaa.jpg',
    'https://picturescdn.estatesales.net/999/1-1/bbb.jpg']);
  assert.equal(record.description, 'Tools and furniture throughout the house.');
  assert.equal(record.photoText, 'Brass figurines');
});

test('EstateSales.net: a phone the listing does not show stays unpublished', () => {
  const record = netListing(netPage({isOrg: true, name: 'Acme Estate Sales', primaryPhone: '(713) 555-0119',
    showPhoneNumber: false, websiteUrl: '', pageUrl: '/companies/TX/Houston/77005/42'}),
  'https://www.estatesales.net/TX/Houston/77005/999');
  assert.equal(record.contactPhone, undefined);
  assert.equal(record.contactUrl, 'https://www.estatesales.net/companies/TX/Houston/77005/42');
});

test('EstateSales.org: schema contact, description and gallery photos are captured', () => {
  const event = {
    '@type': 'Event', name: 'Houston Estate Sale!',
    description: 'Karges dining table, Bavarian china set, Sony camera.',
    image: ['https://eso-cdn.tlcdn.workers.dev/s-42-hero.jpg'],
    location: {address: {addressLocality: 'Houston', postalCode: '77005'}},
    organizer: {'@type': 'Organization', name: 'Elite Estate Sales Inc', telephone: '(832) 791-1389',
      url: 'https://estatesales.org/estate-sale-companies/elite-estate-sales-21627'},
  };
  const html = `<html><body>
    <span>In-person:</span> <ul><li>Sat, Nov 21, 2026 9AM - 3PM</li></ul>
    <h4>Sale Address</h4> <div><span>1210 W Gray St<br></span></div>
    <img alt="Estate sale photo" src="https://eso-cdn.tlcdn.workers.dev/s-42-hero-t.jpg" data-aspect="https://eso-cdn.tlcdn.workers.dev/s-42-hero.jpg">
    <img alt="Estate sale photo" src="https://eso-cdn.tlcdn.workers.dev/s-42-two-t.jpg" data-aspect="https://eso-cdn.tlcdn.workers.dev/s-42-two.jpg">
    <img alt="Estate sale photo" src="https://eso-cdn.tlcdn.workers.dev/s-42-three-t.jpg" data-aspect="https://eso-cdn.tlcdn.workers.dev/s-42-three.jpg">
    <script type="application/ld+json">${JSON.stringify(event)}</script></body></html>`;
  const record = orgListing(html, 'https://estatesales.org/estate-sales/tx/houston/77005/x-42');
  assert.equal(record.contactPhone, '(832) 791-1389');
  assert.equal(record.contactUrl, 'https://estatesales.org/estate-sale-companies/elite-estate-sales-21627');
  assert.equal(record.photoCount, 3);
  assert.equal(record.photoUrls.length, 3);
  assert.match(record.description, /china set/);
});

test('Craigslist: a phone written in the posting and its photos are captured', () => {
  const html = `<html><head><meta name="geo.placename" content="Houston, TX 77005"></head><body>
    <span id="titletextonly">Estate Sale - Tools &amp; Furniture</span>
    <p><span>start time:</span><span>9:00 AM</span></p>
    <a href="?sale_date=2026-11-21">Sat</a>
    <section id="postingbody">Estate sale this weekend. Tools and furniture. Call (713) 555-0119 for info.</section>
    <img src="https://images.craigslist.org/00a0a_abcd_600x450.jpg">
    <img src="https://images.craigslist.org/00a0a_abcd_1200x900.jpg">
    <img src="https://images.craigslist.org/00b0b_efgh_600x450.jpg">
    </body></html>`;
  const record = craigslistSale(html, 'https://www.craigslist.org/view/d/x/1',
    {today: '2026-11-21', through: '2026-12-04',
      city: {sources: {craigslist: {name: 'Craigslist Houston'}}, state: {code: 'TX', name: 'Texas'}}});
  assert.equal(record.contactPhone, '(713) 555-0119');
  assert.equal(record.photoCount, 2);
  assert.equal(record.photoUrls[0], 'https://images.craigslist.org/00a0a_abcd_1200x900.jpg');
  assert.match(record.description, /Tools and furniture/);
});

test('EstateSale.com: the printed company phone, description and photos are captured', () => {
  const html = `<html><body>
    <h1>Tools &amp; Furniture Estate Sale</h1>
    <div>Sale Description</div><div>Garage full of tools, walnut furniture and brass figurines.</div>
    <div>Sale Location</div><div>1210 W Gray St</div><div>Houston, TX 77005</div>
    <div>Sale Dates and Times</div><div>Saturday November 21, 2026 9:00 AM - 3:00 PM</div>
    <div>Sale Type</div><div>Estate Sale</div>
    <div>Company Information</div><div>Acme Estate Sales</div><div>Phone: (713) 555-0119</div>
    <a href="/companies/view/42/Acme.html">Acme Estate Sales</a>
    <img src="https://www.estatesale.com/photos/99/figurines.jpg">
    <img src="https://www.estatesale.com/images/logo.png">
    </body></html>`;
  const record = estateSaleCom(html, 'https://www.estatesale.com/sales/view/99.html',
    {today: '2026-11-21', through: '2026-12-04', city: {state: {code: 'TX', name: 'Texas'}}});
  assert.equal(record.company, 'Acme Estate Sales');
  assert.equal(record.contactPhone, '(713) 555-0119');
  assert.equal(record.contactUrl, 'https://www.estatesale.com/companies/view/42/Acme.html');
  assert.match(record.description, /brass figurines/);
  assert.deepEqual(record.photoUrls, ['https://www.estatesale.com/photos/99/figurines.jpg']);
  assert.equal(record.photoCount, 1);
});
