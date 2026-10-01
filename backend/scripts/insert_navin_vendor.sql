INSERT INTO vendors (id, email, major_category, status, source, raw, created_at, updated_at)
VALUES (
  'v-navin-9157154504',
  'navin.procucev@gmail.com',
  'Bearings & Accessories',
  'PREFERRED ENTERPRISE SUPPLIER',
  'self_registration',
  '{"name":"Navin Enterprise","contactPerson":"Navin","phone":"9157154504","mobile":"9157154504","mobileNumber":"9157154504","majorCategory":"Bearings & Accessories","minorCategories":["Bearings","Industrial Bearings","Pumps & Accessories","Industrial Fasteners","Valves","Electrical","IT"],"email":"navin.procucev@gmail.com","id":"v-navin-9157154504","buyerId":null,"buyerAccountId":null,"rating":5,"score":95,"source":"self_registration","status":"PREFERRED ENTERPRISE SUPPLIER","evaluated":true,"hasRecord":false,"isExistingInDatabase":true,"onboardingEmailStatus":"completed","isCategoryAligned":true,"subscriptionPlan":"connect","rfqDownloadsUsed":0,"brandName":"","orgType":"Private Limited","pan":"AAACR5055K","gst":"27AAACR5055K1Z7","msme":"","website":"","annualTurnover":"","factoryAddress":"","city":"Ahmedabad","state":"Gujarat","pincode":"380001","country":"India","location":"Ahmedabad, Gujarat","contactDesignation":"Owner","clientMappedCategories":["Bearings & Accessories","Industrial Bearings","Pumps & Accessories","Industrial Fasteners","Valves","Electrical","IT"],"vendorSelectedCategories":["Bearings & Accessories","Industrial Bearings","Pumps & Accessories","Industrial Fasteners","Valves","Electrical","IT"],"freeQuotationCredits":10,"quotedRfqIds":[]}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  major_category = EXCLUDED.major_category,
  status = EXCLUDED.status,
  source = EXCLUDED.source,
  raw = EXCLUDED.raw,
  updated_at = CURRENT_TIMESTAMP;
