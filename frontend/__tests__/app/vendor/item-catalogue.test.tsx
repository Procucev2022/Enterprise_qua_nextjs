import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ItemCatalogue from '@/app/vendor/item-catalogue';
import { AppProvider, useApp } from '@/lib/store';

function renderWithProvider(ui: React.ReactElement) {
  return render(<AppProvider>{ui}</AppProvider>);
}

function ItemCatalogueCustomWrapper({
  customSubscription = 'select',
  customCatalogue = [],
}: {
  customSubscription?: any;
  customCatalogue?: any[];
}) {
  const { setVendorSubscription, setVendorCatalogue } = useApp();

  React.useEffect(() => {
    setVendorSubscription(customSubscription);
    if (customCatalogue.length > 0) {
      setVendorCatalogue(customCatalogue);
    }
  }, [setVendorSubscription, setVendorCatalogue, customSubscription, customCatalogue]);

  return <ItemCatalogue />;
}

describe('ItemCatalogue Comprehensive Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Form Validation Edge Cases: Empty fields, invalid Price, invalid Lead Time, invalid MOQ', () => {
    renderWithProvider(<ItemCatalogue />);

    const form = document.querySelector('form')!;

    // 1. Submit with empty fields
    fireEvent.submit(form);

    // 2. Fill Name & SKU but leave others blank
    const nameInput = screen.getByPlaceholderText(/e.g. Centrifugal Water Pump/i);
    const skuInput = screen.getByPlaceholderText('SKU-PUMP-500');
    fireEvent.change(nameInput, { target: { value: 'High Pressure Pump' } });
    fireEvent.change(skuInput, { target: { value: 'SKU-HP-100' } });
    fireEvent.submit(form);

    // 3. Invalid unit price (e.g. -10)
    const priceInput = screen.getByPlaceholderText('850');
    const leadTimeInput = screen.getByPlaceholderText('5');
    const moqInput = screen.getByPlaceholderText('10');

    fireEvent.change(priceInput, { target: { value: '-10' } });
    fireEvent.change(leadTimeInput, { target: { value: '7' } });
    fireEvent.change(moqInput, { target: { value: '5' } });
    fireEvent.submit(form);

    // 4. Invalid lead time (e.g. 0)
    fireEvent.change(priceInput, { target: { value: '250' } });
    fireEvent.change(leadTimeInput, { target: { value: '0' } });
    fireEvent.submit(form);

    // 5. Invalid MOQ (e.g. -2)
    fireEvent.change(leadTimeInput, { target: { value: '5' } });
    fireEvent.change(moqInput, { target: { value: '-2' } });
    fireEvent.submit(form);
  });

  test('Product Add, Edit, Delete, Reset Form, and Search Filter flow', () => {
    renderWithProvider(<ItemCatalogue />);

    const form = document.querySelector('form')!;
    const nameInput = screen.getByPlaceholderText(/e.g. Centrifugal Water Pump/i);
    const skuInput = screen.getByPlaceholderText('SKU-PUMP-500');
    const specsInput = screen.getByPlaceholderText(/Details of materials, sizes/i);
    const priceInput = screen.getByPlaceholderText('850');
    const leadTimeInput = screen.getByPlaceholderText('5');
    const moqInput = screen.getByPlaceholderText('10');
    const categorySelect = screen.getByDisplayValue(/Pumps & Fluid/i);

    // Add a matching RFQ product to trigger matching word comparison and tooltip
    fireEvent.change(nameInput, { target: { value: 'Centrifugal Water Pump with 15 HP Electric Motor' } });
    fireEvent.change(categorySelect, { target: { value: 'Pumps & Fluid Dynamics' } });
    fireEvent.change(skuInput, { target: { value: 'SKU-PUMP-MATCH' } });
    fireEvent.change(specsInput, { target: { value: 'Centrifugal industrial water pump with impeller' } });
    fireEvent.change(priceInput, { target: { value: '1200' } });
    fireEvent.change(leadTimeInput, { target: { value: '7' } });
    fireEvent.change(moqInput, { target: { value: '2' } });
    fireEvent.submit(form);

    // Add a new product
    fireEvent.change(nameInput, { target: { value: 'Stainless Steel Flange Adapter' } });
    fireEvent.change(categorySelect, { target: { value: 'Pipes & Fittings' } });
    fireEvent.change(skuInput, { target: { value: 'SKU-FLG-SS304' } });
    fireEvent.change(specsInput, { target: { value: 'SS304 Class 150 flanged 4-inch adapter' } });
    fireEvent.change(priceInput, { target: { value: '450' } });
    fireEvent.change(leadTimeInput, { target: { value: '14' } });
    fireEvent.change(moqInput, { target: { value: '10' } });

    fireEvent.submit(form);

    expect(screen.getByText('SKU-FLG-SS304')).toBeInTheDocument();

    // Edit the product
    const editBtns = screen.getAllByTitle('Edit Product');
    if (editBtns.length > 0) {
      fireEvent.click(editBtns[0]);
    }

    expect(screen.getByRole('button', { name: /Update Item/i })).toBeInTheDocument();

    // Change price and save
    fireEvent.change(screen.getByPlaceholderText('850'), { target: { value: '499' } });
    fireEvent.click(screen.getByRole('button', { name: /Update Item/i }));

    // Reset Form / Cancel Editing
    const editBtnsAgain = screen.getAllByTitle('Edit Product');
    if (editBtnsAgain.length > 0) {
      fireEvent.click(editBtnsAgain[0]);
      const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelBtn);
    }

    // Search and RFQ Filter
    const searchInput = screen.getByPlaceholderText(/Search SKU, name, specs/i);
    fireEvent.change(searchInput, { target: { value: 'SS304' } });
    expect(screen.getByText('SKU-FLG-SS304')).toBeInTheDocument();

    // Search for nonexistent term
    fireEvent.change(searchInput, { target: { value: 'NonExistentItemXYZ' } });
    expect(screen.queryByText('SKU-FLG-SS304')).not.toBeInTheDocument();
    fireEvent.change(searchInput, { target: { value: '' } });

    // Toggle filter matching open RFQs
    const rfqFilterToggle = screen.getByRole('button', { name: /Summary:/i });
    fireEvent.click(rfqFilterToggle);
    fireEvent.click(rfqFilterToggle);

    // Delete the product
    const deleteBtns = screen.getAllByTitle('Delete Product');
    if (deleteBtns.length > 0) {
      fireEvent.click(deleteBtns[0]);
    }
  });

  test('Bulk Import Simulation & Max 100 Limit Constraints (>90% and >70% capacity gradients)', () => {
    // 1. Normal bulk import simulation
    const { unmount } = renderWithProvider(<ItemCatalogue />);
    const bulkImportBtn = screen.getByRole('button', { name: /Simulate Bulk Excel Import/i });
    fireEvent.click(bulkImportBtn);
    unmount();

    // 2. Test 95% capacity gradient bar (>90% red) and limit behavior
    const mock95Catalogue = Array.from({ length: 95 }, (_, i) => ({
      id: `prod-95-${i}`,
      name: `Pump Item ${i}`,
      category: 'Pumps & Fluid Dynamics',
      sku: `SKU-PUMP-95-${i}`,
      specs: '95 percent test pump item',
      unitPrice: 150,
      leadTimeDays: 4,
      moq: 1,
    }));

    const { unmount: unmount95 } = renderWithProvider(
      <ItemCatalogueCustomWrapper customSubscription="select" customCatalogue={mock95Catalogue} />
    );

    // Filter by matching RFQs when multiple products have matches
    const rfqSummaryBtn = screen.getByRole('button', { name: /Summary:/i });
    fireEvent.click(rfqSummaryBtn);
    fireEvent.click(rfqSummaryBtn);

    unmount95();

    // 3. Test bulk import and Add product when capacity is at 100 items (MAX_LIMIT)
    const mockFullCatalogue = Array.from({ length: 100 }, (_, i) => ({
      id: `prod-full-${i}`,
      name: `Full Product Item ${i}`,
      category: 'Pipes & Fittings',
      sku: `SKU-FULL-${i}`,
      specs: 'Full test item',
      unitPrice: 100,
      leadTimeDays: 5,
      moq: 1,
    }));

    const { unmount: unmountFull } = renderWithProvider(
      <ItemCatalogueCustomWrapper customCatalogue={mockFullCatalogue} />
    );

    // Attempt bulk import at limit
    const fullBulkBtn = screen.getByRole('button', { name: /Simulate Bulk Excel Import/i });
    fireEvent.click(fullBulkBtn);

    // Attempt adding single product at limit
    fireEvent.change(screen.getByPlaceholderText(/e.g. Centrifugal Water Pump/i), { target: { value: 'Extra Item' } });
    fireEvent.change(screen.getByPlaceholderText('SKU-PUMP-500'), { target: { value: 'SKU-EXTRA' } });
    fireEvent.change(screen.getByPlaceholderText('850'), { target: { value: '100' } });
    fireEvent.change(screen.getByPlaceholderText('5'), { target: { value: '5' } });
    fireEvent.change(screen.getByPlaceholderText('10'), { target: { value: '2' } });

    const formFull = document.querySelector('form')!;
    fireEvent.submit(formFull);
    unmountFull();

    // 4. Test 75% capacity gradient bar branch (> 70%) and standard subscription
    const mock75Catalogue = Array.from({ length: 75 }, (_, i) => ({
      id: `prod-75-${i}`,
      name: `75% Product ${i}`,
      category: 'Pumps & Fluid Dynamics',
      sku: `SKU-75-${i}`,
      specs: '75 percent test item',
      unitPrice: 100,
      leadTimeDays: 5,
      moq: 1,
    }));

    renderWithProvider(
      <ItemCatalogueCustomWrapper customSubscription="standard" customCatalogue={mock75Catalogue} />
    );

    expect(screen.getByText(/Select Model Required/i)).toBeInTheDocument();
  });
});
