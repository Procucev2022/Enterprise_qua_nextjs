import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import * as XLSX from 'xlsx';
import InitialSetupModal from '@/app/buyer/initial-setup-modal';
import { useApp } from '@/lib/store';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

// Mock FileReader for synchronous, reliable Excel file parsing
class MockFileReader {
  onload: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;

  readAsArrayBuffer(file: any) {
    if (file.__error) {
      if (this.onerror) this.onerror(new Error('Read error'));
      return;
    }
    if (file.__corrupt) {
      if (this.onload) {
        this.onload(null as any);
      }
      return;
    }
    const buf = file.__buffer !== undefined ? file.__buffer : new ArrayBuffer(0);
    if (this.onload) {
      this.onload({ target: { result: buf } });
    }
  }
}

describe('app/buyer/initial-setup-modal.tsx', () => {
  const originalFileReader = global.FileReader;
  const originalFetch = global.fetch;
  const mockSetInitialSetupModalOpen = jest.fn();
  const mockSetHistoricalPurchaseDataPeriod = jest.fn();
  const mockProcessHistoricalPurchaseData = jest.fn();
  const mockShowToast = jest.fn();

  const mockBuyerVendors: any[] = [
    {
      id: 'v-1',
      vendorCode: 'VND-1001',
      name: 'Apex Supplies Ltd.',
      contactPerson: 'Rajesh Nair',
      email: 'rajesh@apex.in',
      phone: '+91 98201 44820',
      location: 'Pune, Maharashtra',
      score: 95,
      vendorRatingScore: 95,
      source: 'buyer_manual',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      evaluated: true,
    },
    {
      id: 'v-2',
      vendorCode: 'VND-1002',
      name: 'Global Valves Ltd',
      contactPerson: 'Suresh Rao',
      email: 'suresh@globalvalves.in',
      phone: '+91 98201 55443',
      location: 'Vadodara, Gujarat',
      score: 75,
      vendorRatingScore: 75,
      rating: 3.75,
      source: 'buyer_manual',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      evaluated: true,
    },
    {
      id: 'v-3',
      vendorCode: 'VND-1003',
      name: 'Delta Compressors Ltd',
      email: 'delta@compressors.in',
      score: 45,
      vendorRatingScore: 45,
      source: 'buyer_manual',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      evaluated: false,
    },
    {
      id: 'v-4',
      vendorCode: 'VND-1004',
      name: 'Unrated Supplier Inc',
      email: 'info@unrated.in',
      source: 'buyer_manual',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      evaluated: false,
    },
  ];

  beforeAll(() => {
    (global as any).FileReader = MockFileReader;
    HTMLAnchorElement.prototype.click = jest.fn();
  });

  afterAll(() => {
    global.FileReader = originalFileReader;
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/api/buyer-accounts/ai-categorize')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            categorizedVendors: [
              {
                id: 'v-1',
                vendorCode: 'VND-1001',
                primaryMajorCategory: 'Engineering Spares - Mechanical',
                minorCategories: ['Pumps & Accessories', 'Industrial Valves'],
                productLines: ['Industrial Pumps'],
                aiConfidenceScore: 96,
                aiReason: 'AI identified centrifugal pumps and valves from POs.',
                hasPoHistory: true,
                totalSpend: 150000,
                poCount: 2,
              },
            ],
            aiModel: 'Google Gemini 1.5 Pro Neural',
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    (useApp as jest.Mock).mockReturnValue({
      initialSetupModalOpen: true,
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      historicalPurchaseDataPeriod: '2_years',
      setHistoricalPurchaseDataPeriod: mockSetHistoricalPurchaseDataPeriod,
      processHistoricalPurchaseData: mockProcessHistoricalPurchaseData,
      activeBuyerAccount: { id: 'org-test-01', organizationName: 'Larsen & Toubro Limited' },
      buyerVendors: mockBuyerVendors,
      showToast: mockShowToast,
    });
  });

  it('renders null when initialSetupModalOpen is false', () => {
    (useApp as jest.Mock).mockReturnValue({
      initialSetupModalOpen: false,
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      historicalPurchaseDataPeriod: '2_years',
      setHistoricalPurchaseDataPeriod: mockSetHistoricalPurchaseDataPeriod,
      processHistoricalPurchaseData: mockProcessHistoricalPurchaseData,
      activeBuyerAccount: null,
      buyerVendors: [],
      showToast: mockShowToast,
    });

    const { container } = render(<InitialSetupModal />);
    expect(container.firstChild).toBeNull();
  });

  it('walks through the 5 steps and saves processed data with activeBuyerAccount null', async () => {
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = jest.fn();

    (useApp as jest.Mock).mockReturnValue({
      initialSetupModalOpen: true,
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      historicalPurchaseDataPeriod: '2_years',
      setHistoricalPurchaseDataPeriod: mockSetHistoricalPurchaseDataPeriod,
      processHistoricalPurchaseData: mockProcessHistoricalPurchaseData,
      activeBuyerAccount: null,
      buyerVendors: mockBuyerVendors,
      showToast: mockShowToast,
    });

    render(<InitialSetupModal />);

    // STEP 1: Select Period
    expect(screen.getByText(/Step 1: Choose Historical Purchase Period/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Last 1 Year \(12 Months\)/i));
    expect(mockSetHistoricalPurchaseDataPeriod).toHaveBeenCalledWith('1_year');

    fireEvent.click(screen.getByText(/Last 3 Years \(36 Months\)/i));
    expect(mockSetHistoricalPurchaseDataPeriod).toHaveBeenCalledWith('3_years');

    // Continue to STEP 2
    fireEvent.click(screen.getByText(/Continue to File 1: Vendor Master/i));
    expect(screen.getByText(/Step 2: Upload File 1/i)).toBeInTheDocument();

    // Rating badges check in step 2 table
    expect(screen.getByText('95/100')).toBeInTheDocument();
    expect(screen.getByText('75/100')).toBeInTheDocument();
    expect(screen.getByText('45/100')).toBeInTheDocument();
    expect(screen.getByText('N/A')).toBeInTheDocument();

    // Download CSV template
    fireEvent.click(screen.getByText(/Download CSV Template/i));
    expect(mockShowToast).toHaveBeenCalledWith('Template Downloaded', expect.any(String), 'success');

    // Reset Template in Step 2
    fireEvent.click(screen.getByText('Reset Template'));
    expect(mockShowToast).toHaveBeenCalledWith('Reset Complete', expect.any(String), 'info');

    // Continue to STEP 3 using Proceed to File 2: PO Dump button
    fireEvent.click(screen.getByText(/Proceed to File 2: PO Dump/i));
    expect(screen.getByText(/Step 3: Upload File 2/i)).toBeInTheDocument();

    // Download PO dump template
    fireEvent.click(screen.getByText(/Download CSV Template/i));
    expect(mockShowToast).toHaveBeenCalledWith('Template Downloaded', expect.any(String), 'success');

    // Reset PO in Step 3
    fireEvent.click(screen.getByText('Reset Template'));
    expect(mockShowToast).toHaveBeenCalledWith('Reset Complete', expect.any(String), 'info');

    // Run AI Cross-Match simulation to enter STEP 4
    await act(async () => {
      fireEvent.click(screen.getByText(/Run AI Category Cross-Match/i));
    });

    // STEP 4: Category Review & Cross Join
    expect(screen.getByText(/Step 4: AI Cross-Match/i)).toBeInTheDocument();
    expect(screen.getByText(/AI Engine:/i)).toBeInTheDocument();

    // Tab filters in Step 4
    const filterTabs = screen.getAllByRole('button');
    const mappedTab = filterTabs.find((b) => b.textContent?.includes('Mapped'));
    if (mappedTab) fireEvent.click(mappedTab);

    const unmappedTab = filterTabs.find((b) => b.textContent?.includes('Unmapped'));
    if (unmappedTab) fireEvent.click(unmappedTab);

    const allTab = filterTabs.find((b) => b.textContent?.includes('All'));
    if (allTab) fireEvent.click(allTab);

    // Test editing manual category override
    const editBtns = screen.getAllByText(/Edit \/ Review/i);
    if (editBtns[0]) {
      fireEvent.click(editBtns[0]);
    }

    // Attempt save with empty major category -> validation toast
    const majorInput = screen.getByPlaceholderText(/e\.g\. Engineering Spares/i);
    fireEvent.change(majorInput, { target: { value: '' } });
    const saveOverrideBtn = screen.getByText('Save Override');
    fireEvent.click(saveOverrideBtn);
    expect(mockShowToast).toHaveBeenCalledWith('Validation Error', expect.any(String), 'warning');

    // Save with valid major and custom minors
    fireEvent.change(majorInput, { target: { value: 'Custom Engineering Spares' } });
    const minorsInput = screen.getByPlaceholderText(/Pumps & Accessories/i);
    fireEvent.change(minorsInput, { target: { value: 'Turbines, High Temp Valves' } });
    fireEvent.click(saveOverrideBtn);
    expect(mockShowToast).toHaveBeenCalledWith('Category Updated', expect.any(String), 'success');

    // Test second edit with empty minors to test fallback to General Spares
    const secondEditBtns = screen.getAllByText(/Edit \/ Review/i);
    if (secondEditBtns[1]) {
      fireEvent.click(secondEditBtns[1]);
      const majorInput2 = screen.getByPlaceholderText(/e\.g\. Engineering Spares/i);
      fireEvent.change(majorInput2, { target: { value: 'Turbine Systems' } });
      const minorsInput2 = screen.getByPlaceholderText(/Pumps & Accessories/i);
      fireEvent.change(minorsInput2, { target: { value: '   ' } });
      fireEvent.click(screen.getByText('Save Override'));
    }

    // Continue to Step 5 using Review Email Dispatch button
    fireEvent.click(screen.getByText(/Review Email Dispatch & Finalize/i));
    expect(screen.getByText(/Step 5: Confirm Ingestion/i)).toBeInTheDocument();

    // Save and commit
    await act(async () => {
      fireEvent.click(screen.getByText(/COMPLETE SETUP & INGEST/i));
    });
    expect(mockProcessHistoricalPurchaseData).toHaveBeenCalled();
  });

  it('handles back button navigation and modal close (X button)', () => {
    render(<InitialSetupModal />);

    // Step 1 -> Step 2
    fireEvent.click(screen.getByText(/Continue to File 1: Vendor Master/i));
    expect(screen.getByText(/Step 2: Upload File 1/i)).toBeInTheDocument();

    // Back to step 1
    fireEvent.click(screen.getByText('Back to Period'));
    expect(screen.getByText(/Step 1: Choose Historical Purchase Period/i)).toBeInTheDocument();

    // Step 2 -> Step 3
    fireEvent.click(screen.getByText('2. Vendor Master'));
    fireEvent.click(screen.getByText('3. PO Dump'));
    expect(screen.getByText(/Step 3: Upload File 2/i)).toBeInTheDocument();

    // Back to step 2
    fireEvent.click(screen.getByText('Back to Vendor Master'));
    expect(screen.getByText(/Step 2: Upload File 1/i)).toBeInTheDocument();

    // Step 3 -> Step 4
    fireEvent.click(screen.getByText('3. PO Dump'));
    fireEvent.click(screen.getByText('4. AI Category Join'));
    expect(screen.getByText(/Step 4: AI Cross-Match/i)).toBeInTheDocument();

    // Back to step 3
    fireEvent.click(screen.getByText('Back to PO Dump'));
    expect(screen.getByText(/Step 3: Upload File 2/i)).toBeInTheDocument();

    // Step 4 -> Step 5
    fireEvent.click(screen.getByText('5. Dispatch Emails'));
    expect(screen.getByText(/Step 5: Confirm Ingestion/i)).toBeInTheDocument();

    // Back to step 4
    fireEvent.click(screen.getByText('Back to Category Join'));
    expect(screen.getByText(/Step 4: AI Cross-Match/i)).toBeInTheDocument();

    // Close modal via top-right close button
    const closeBtns = screen.getAllByRole('button');
    const xBtn = closeBtns.find((b) => b.querySelector('svg.lucide-x'));
    if (xBtn) fireEvent.click(xBtn);
    expect(mockSetInitialSetupModalOpen).toHaveBeenCalledWith(false);
  });

  it('handles excel file uploads, column aliases, empty values, errors, and cross-category AI parsing', async () => {
    // 1. Create valid Vendor Master workbook with alternate column aliases and empty fallbacks
    const wsVendors = XLSX.utils.json_to_sheet([
      {
        'Vendor Code': 'V-101',
        'Company Name': 'Apex Supplies Ltd.',
        'Contact Person': 'Aarav Patel',
        Email: 'aarav@apex.in',
        Phone: '+91 98000 11111',
        Address: 'Pune Hub, MH',
        GSTIN: '27AAACG1234A1Z1',
        Rating: 92,
      },
      {
        code: 'V-102',
        vendorname: 'TechnoForce Electricals Ltd',
        contact: 'Pooja Verma',
        email_id: 'pooja@technoforce.com',
        mobile: '+91 98000 22222',
        location: 'Bengaluru, KA',
        taxid: '29AAACT1234A1Z2',
        score: 88,
      },
      {
        suppliercode: 'V-103',
        suppliername: 'Everest Steel & Infra',
        representative: 'Vikram Rawat',
        mail: 'vikram@everest.com',
        telephone: '+91 98000 33333',
        city: 'Kolkata, WB',
        gst: '19AAACE1234A1Z3',
        vendorrating: 85,
      },
      {
        vendorid: 'V-104',
        supplier: 'Delta Compressors Ltd',
        person: 'Sanjay Rawat',
        corporateemail: 'sanjay@delta.com',
        contactnumber: '+91 98000 44444',
        plantlocation: 'Ahmedabad, GJ',
        gstno: '24AAACD1234A1Z4',
        rating0100: '75',
      },
      {
        'Vendor Code': 'V-105',
        'Company Name': 'Fluid Hydro Services',
        'Contact Person': 'Rohan Shah',
        Email: 'rohan@fluidhydro.in',
        Phone: '+91 98000 55555',
        Address: 'Surat, GJ',
        GSTIN: '24AAACH1234A1Z5',
        Rating: 80,
      },
      {
        'Vendor Code': 'V-106',
        'Company Name': 'Relay Control Systems',
        'Contact Person': 'Kunal Sen',
        Email: 'kunal@relaycontrol.in',
        Phone: '+91 98000 66666',
        Address: 'Nagpur, MH',
        GSTIN: '27AAACR1234A1Z6',
        Rating: 85,
      },
      {
        id: '',
        name: '',
        contactperson: '',
        email: '',
        phonenumber: '',
        officeaddress: '',
        gstnumber: '',
        performancescore: '110',
      },
    ]);
    const wbVendor = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbVendor, wsVendors, 'Vendors');
    const vendorBuffer = XLSX.write(wbVendor, { type: 'array', bookType: 'xlsx' });
    const vendorFile: any = new File([vendorBuffer], 'custom_vendors.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    vendorFile.__buffer = vendorBuffer;

    // 2. Create valid PO Line Items workbook covering all column aliases and categories
    const wsPOs = XLSX.utils.json_to_sheet([
      {
        'PO Number': 'PO-9001',
        'PO Date': '2025-03-01',
        'Vendor Name': 'Apex Supplies Ltd.',
        'Item Name': 'Centrifugal Water Pump 500 GPM',
        Specs: 'High Pressure DIN standard 15HP',
        Quantity: 5,
        Unit: 'Units',
        'Unit Price': 12000,
        'Total Spend': 60000,
        Department: 'Piping & Mechanical',
      },
      {
        'po #': 'PO-9002',
        orderdate: '2025-04-01',
        vendor: 'Apex Supplies Ltd.',
        itemdescription: 'Industrial Gate Valve, Globe & Hydraulic Hose with Air Compressor',
        itemspecs: 'Class 150 PN16 with 20HP Motor',
        qty: 10,
        uom: 'Units',
        rate: 3000,
        spend: 30000,
        dept: 'Mechanical',
      },
      {
        pono: 'PO-9003',
        date: '2025-05-01',
        supplier: 'TechnoForce Electricals Ltd',
        material: 'LV Switchgear Modular Panels with Drawout MCCB & Breakers Cables',
        details: '415V 50Hz 3-Phase',
        units: 2,
        unitofmeasure: 'Panels',
        price: 85000,
        totalamount: 170000,
        costcenter: 'Electrical',
      },
      {
        orderid: 'PO-9004',
        creationdate: '2025-06-01',
        companyname: 'Everest Steel & Infra',
        productname: 'Fe500D TMT Bars & PEB Structure Roofing Sheets for Civil Works',
        grade: 'IS 1786 Grade',
        count: 50,
        unit: 'Tons',
        itemprice: 60000,
        poamount: 3000000,
        plant: 'Civil',
      },
      {
        ordernumber: 'PO-9005',
        podate: '2025-07-01',
        vendorcode: 'Delta Compressors Ltd',
        description: 'Compressor Spares and Motor Maintenance Parts',
        technicalspecs: 'ISO Grade',
        orderedqty: 20,
        unit: 'Boxes',
        unitprice: '500',
        totalvalue: '10000',
        category: 'Utilities',
      },
      {
        'PO Number': 'PO-9006',
        'PO Date': '2025-08-01',
        'Vendor Name': 'Fluid Hydro Services',
        'Item Name': 'Industrial 500 GPM Fluid Line',
        Specs: 'Standard PSI rating',
        Quantity: 2,
        Unit: 'Sets',
        'Unit Price': 5000,
        'Total Spend': 10000,
      },
      {
        'PO Number': 'PO-9007',
        'PO Date': '2025-08-02',
        'Vendor Name': 'Relay Control Systems',
        'Item Name': 'Protection Relay Module 415V',
        Specs: 'Insulated',
        Quantity: 5,
        Unit: 'Rolls',
        'Unit Price': 2000,
        'Total Spend': 10000,
      },
      {
        ponumber: '',
        podate: '',
        vendoridentifier: '',
        itemname: '',
        specs: '',
        quantity: 'invalid',
        unit: '',
        unitprice: '',
        totalspend: '',
        division: 'General',
      },
    ]);
    const wbPO = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbPO, wsPOs, 'POs');
    const poBuffer = XLSX.write(wbPO, { type: 'array', bookType: 'xlsx' });
    const poFile: any = new File([poBuffer], 'custom_pos.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    poFile.__buffer = poBuffer;

    const { container } = render(<InitialSetupModal />);

    // Go to Step 2 (Vendor Master)
    fireEvent.click(screen.getByText('2. Vendor Master'));

    // Test dropzone click and Choose Another File click on Step 2
    const vDropZone = container.querySelector('.border-dashed');
    if (vDropZone) {
      fireEvent.click(vDropZone);
      fireEvent.dragOver(vDropZone);
      fireEvent.dragLeave(vDropZone);
      fireEvent.drop(vDropZone, {
        dataTransfer: { files: [vendorFile] },
      });
    }

    const chooseBtns = screen.getAllByText('Choose Another File');
    if (chooseBtns[0]) fireEvent.click(chooseBtns[0]);

    // Test file input change in Step 2
    const vInput = container.querySelector('input[type="file"]');
    if (vInput) {
      fireEvent.change(vInput, { target: { files: [vendorFile] } });
    }

    // Test empty file, error file, and corrupt file on Step 2
    const emptyWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(emptyWb, XLSX.utils.json_to_sheet([]), 'Empty');
    const emptyBuffer = XLSX.write(emptyWb, { type: 'array', bookType: 'xlsx' });
    const emptyFile: any = new File([emptyBuffer], 'empty.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    emptyFile.__buffer = emptyBuffer;

    if (vInput) {
      fireEvent.change(vInput, { target: { files: [emptyFile] } });
    }

    const errFile: any = new File([], 'err.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    errFile.__error = true;
    if (vInput) {
      fireEvent.change(vInput, { target: { files: [errFile] } });
    }

    const corruptFile: any = new File([], 'corrupt.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    corruptFile.__corrupt = true;
    if (vInput) {
      fireEvent.change(vInput, { target: { files: [corruptFile] } });
    }

    // Unsupported file type — rejected before parsing
    const badTypeFile: any = new File(['not a spreadsheet'], 'resume.pdf', { type: 'application/pdf' });
    if (vInput) {
      fireEvent.change(vInput, { target: { files: [badTypeFile] } });
    }

    // Go to Step 3 (PO Dump)
    fireEvent.click(screen.getByText('3. PO Dump'));

    const poDropZones = container.querySelectorAll('.border-dashed');
    if (poDropZones[0]) {
      fireEvent.click(poDropZones[0]);
      fireEvent.dragOver(poDropZones[0]);
      fireEvent.dragLeave(poDropZones[0]);
      fireEvent.drop(poDropZones[0], {
        dataTransfer: { files: [poFile] },
      });
    }

    const pChooseBtns = screen.getAllByText('Choose Another File');
    if (pChooseBtns[0]) fireEvent.click(pChooseBtns[0]);

    const poInput = container.querySelector('input[type="file"]');
    if (poInput) {
      fireEvent.change(poInput, { target: { files: [poFile] } });
      fireEvent.change(poInput, { target: { files: [emptyFile] } });
      fireEvent.change(poInput, { target: { files: [errFile] } });
      fireEvent.change(poInput, { target: { files: [corruptFile] } });
      fireEvent.change(poInput, { target: { files: [badTypeFile] } });
    }

    // Test PO edge cases for unitPrice and totalSpend calculation
    const edgePOsWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      edgePOsWb,
      XLSX.utils.json_to_sheet([
        {
          'PO Number': 'PO-8881',
          'PO Date': '2025-01-01',
          'Vendor Name': 'Apex Supplies Ltd.',
          'Item Name': 'Special Valves',
          Quantity: 10,
          'Unit Price': '$500',
          'Total Spend': '$0',
        },
        {
          'PO Number': 'PO-8882',
          'PO Date': '2025-01-02',
          'Vendor Name': 'Apex Supplies Ltd.',
          'Item Name': 'Special Valves 2',
          Quantity: 10,
          'Unit Price': '0',
          'Total Spend': '$5000',
        },
        {
          'PO Number': 'PO-8883',
          'PO Date': '2025-01-03',
          'Vendor Name': 'Delta Compressors Ltd',
          'Item Name': 'General Non-Matching Item',
          Quantity: 1,
          'Unit Price': 100,
          'Total Spend': 100,
        },
      ]),
      'POs'
    );
    const edgePOBuffer = XLSX.write(edgePOsWb, { type: 'array', bookType: 'xlsx' });
    const edgePOFile: any = new File([edgePOBuffer], 'edge_pos.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    edgePOFile.__buffer = edgePOBuffer;

    if (poInput) {
      fireEvent.change(poInput, { target: { files: [edgePOFile] } });
    }

    // Step 4 & Step 5 verification
    await act(async () => {
      fireEvent.click(screen.getByText(/Run AI Category Cross-Match/i));
    });
    expect(screen.getByText(/Step 4: AI Cross-Match/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Review Email Dispatch & Finalize/i));
    expect(screen.getByText(/Step 5: Confirm Ingestion/i)).toBeInTheDocument();
  });

  test('covers complete 5-step user journey, category overrides, template downloads, and ingestion seal', async () => {
    // Test fetch failure path gracefully handled
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const { container } = render(<InitialSetupModal />);

    // Step 1: Time Horizon selections
    fireEvent.click(screen.getByText('1. Time Horizon'));
    fireEvent.click(screen.getByText('Last 2 Years (24 Months)'));
    fireEvent.click(screen.getByText('Last 3 Years (36 Months)'));
    fireEvent.click(screen.getByText('Last 1 Year (12 Months)'));

    const step1Next = screen.getByText(/Continue to File 1: Vendor Master/i);
    fireEvent.click(step1Next);

    // Step 2: Template download and reset
    const downloadCsvBtn = screen.getAllByText(/Download CSV Template/i)[0];
    if (downloadCsvBtn) fireEvent.click(downloadCsvBtn);

    const resetVendorBtn = screen.getByText(/Reset Template/i);
    fireEvent.click(resetVendorBtn);

    const step2Next = screen.getByText(/Proceed to File 2: PO Dump/i);
    fireEvent.click(step2Next);

    // Step 3: Template download and reset
    const resetPoBtn = screen.getAllByText(/Reset Template/i)[0];
    if (resetPoBtn) fireEvent.click(resetPoBtn);

    // Step 4: Category Join Review & Overrides
    await act(async () => {
      fireEvent.click(screen.getByText(/Run AI Category Cross-Match/i));
    });
    expect(screen.getByText(/Step 4: AI Cross-Match/i)).toBeInTheDocument();

    const editButtons = screen.getAllByText(/Edit \/ Review/i);
    if (editButtons[0]) {
      fireEvent.click(editButtons[0]);
    }

    // Cancel edit via Cancel button
    const cancelBtn = screen.getByText('Cancel');
    fireEvent.click(cancelBtn);

    // Open again and close via X button
    if (editButtons[0]) {
      fireEvent.click(editButtons[0]);
    }
    const closeEditorBtn = screen.getByTitle('Close editor');
    fireEvent.click(closeEditorBtn);

    // Step 5: Finalize and seal ingestion
    fireEvent.click(screen.getByText('5. Dispatch Emails'));
    expect(screen.getByText(/Step 5: Confirm Ingestion/i)).toBeInTheDocument();

    await act(async () => {
      const completeBtn = screen.getByText(/COMPLETE SETUP & INGEST/i);
      fireEvent.click(completeBtn);
      // Double click when isConfirmingIngestion is true
      fireEvent.click(completeBtn);
    });
  });

  test('covers diverse vendor parsing, PO category classifications, rating badge variations, and periods', async () => {
    // Custom vendors with diverse POs matching electrical, civil, and general
    const customVendorMaster = [
      {
        id: 'v-elec-test',
        vendorCode: 'V-ELEC',
        name: 'Siemens Electrical Co',
        contactPerson: 'Arun Patel',
        email: 'arun@siemens.in',
        phone: '+91 98765 43210',
        location: 'Mumbai, MH',
        gstin: '27AAACS1234E1Z1',
        rating: 4.8, // 96/100
      },
      {
        id: 'v-civil-test',
        vendorCode: 'V-CIVIL',
        name: 'Tata Infrastructure Ltd',
        gstNumber: '27AAACT9999C1Z2',
        vendorRatingScore: 82, // 82/100
      },
      {
        id: 'v-gen-test',
        vendorCode: 'V-GEN',
        name: 'General Hardware Store',
        rating: 3.0, // 60/100 (red badge)
      },
      {
        id: 'v-unrated-test',
        vendorCode: 'V-UNRATED',
        name: 'Unrated Depot',
      },
    ];

    (useApp as jest.Mock).mockReturnValue({
      initialSetupModalOpen: true,
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      historicalPurchaseDataPeriod: '3_years',
      setHistoricalPurchaseDataPeriod: mockSetHistoricalPurchaseDataPeriod,
      processHistoricalPurchaseData: mockProcessHistoricalPurchaseData,
      activeBuyerAccount: { id: 'org-tata-01', organizationName: 'Tata Motors Limited' },
      buyerVendors: customVendorMaster,
      showToast: mockShowToast,
    });

    const { container } = render(<InitialSetupModal />);

    // Step 2 -> Step 3
    fireEvent.click(screen.getByText('2. Vendor Master'));
    fireEvent.click(screen.getByText('3. PO Dump'));

    // Upload POs covering all branches: Electrical, Civil, General
    const wsPOs = XLSX.utils.json_to_sheet([
      {
        'PO Number': 'PO-ELEC-1',
        'Vendor Code': 'V-ELEC',
        'Item Name': 'LV Switchgear Panel 415v and MCCB Circuit Breaker and Cable Wire',
        Quantity: 5,
        'Unit Price': 50000,
        'Total Spend': 250000,
      },
      {
        'PO Number': 'PO-ELEC-2',
        'Vendor Code': 'V-ELEC',
        'Item Name': 'Electrical Relay and modular panel',
        Quantity: 2,
        'Unit Price': 15000,
        'Total Spend': 30000,
      },
      {
        'PO Number': 'PO-CIVIL-1',
        'Vendor Name': 'Tata Infrastructure Ltd',
        'Item Name': 'Fe500D TMT Reinforcement Bars and PEB Roofing Sheet structure',
        Quantity: 50,
        'Unit Price': 6000,
        'Total Spend': 300000,
      },
      {
        'PO Number': 'PO-GEN-1',
        'Vendor Name': 'General Hardware Store',
        'Item Name': 'Mop and cleaning rags and grease',
        Quantity: 10,
        'Unit Price': 500,
        'Total Spend': 5000,
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsPOs, 'POs');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const file: any = new File([buf], 'classified_pos.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    file.__buffer = buf;

    // Step 2: Vendor Master check rating badges
    fireEvent.click(screen.getByText('2. Vendor Master'));
    expect(screen.getByText('96/100')).toBeInTheDocument();
    expect(screen.getByText('82/100')).toBeInTheDocument();
    expect(screen.getByText('60/100')).toBeInTheDocument();
    expect(screen.getByText('N/A')).toBeInTheDocument();

    // Step 3 -> Upload classified POs
    fireEvent.click(screen.getByText('3. PO Dump'));
    const poInput = container.querySelector('input[type="file"]');
    if (poInput) {
      fireEvent.change(poInput, { target: { files: [file] } });
    }

    // Mock fetch offline/error to exercise full client-side neural fallback classification
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ success: false }),
    });

    // Step 4: AI Cross-Match
    await act(async () => {
      fireEvent.click(screen.getByText(/Run AI Category Cross-Match/i));
    });

    expect(screen.getByText(/Step 4: AI Cross-Match/i)).toBeInTheDocument();
    expect(screen.getByText('Siemens Electrical Co')).toBeInTheDocument();
    expect(screen.getByText('Tata Infrastructure Ltd')).toBeInTheDocument();
  });

  it('covers drag-and-drop, invalid file formats, tab filtering, manual overrides, and email toggles', async () => {
    (useApp as jest.Mock).mockReturnValue({
      initialSetupModalOpen: true,
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      historicalPurchaseDataPeriod: '1_year',
      setHistoricalPurchaseDataPeriod: mockSetHistoricalPurchaseDataPeriod,
      processHistoricalPurchaseData: mockProcessHistoricalPurchaseData,
      activeBuyerAccount: { id: 'buyer-org-1', companyName: 'Reliance Ind' },
      buyerVendors: [
        {
          id: 'vnd-1',
          vendorCode: 'V-001',
          companyName: 'Larsen & Toubro',
          rating: 4.8,
          vendorRatingScore: 96,
          gstNumber: '27AABCL1234F1Z5',
        },
        {
          id: 'vnd-2',
          vendorCode: 'V-002',
          companyName: 'Adani Infra',
          score: 74,
          vendorRatingScore: null,
          rating: null,
          location: 'Ahmedabad',
          gstin: '24AABCA5678B1Z9',
        },
      ],
      showToast: mockShowToast,
    });

    const { container } = render(<InitialSetupModal />);

    // Step 2: Test drag over, drag leave, drop on Vendor Master
    fireEvent.click(screen.getByText('2. Vendor Master'));
    const dropZones = container.querySelectorAll('.border-dashed');
    expect(dropZones.length).toBeGreaterThan(0);

    // Trigger drag events on Step 2
    fireEvent.dragOver(dropZones[0]);
    fireEvent.dragLeave(dropZones[0]);
    fireEvent.drop(dropZones[0], { dataTransfer: { files: [] } });

    // Unsupported file drop
    const invalidFile = new File(['text content'], 'invalid.exe', { type: 'application/octet-stream' });
    fireEvent.drop(dropZones[0], { dataTransfer: { files: [invalidFile] } });
    expect(mockShowToast).toHaveBeenCalledWith(
      'Unsupported File Type',
      expect.stringContaining('not a supported spreadsheet file'),
      'warning'
    );

    // Step 3: Test drag over, drag leave, drop on PO dump
    fireEvent.click(screen.getByText('3. PO Dump'));
    const poDropZones = container.querySelectorAll('.border-dashed');
    if (poDropZones.length > 0) {
      fireEvent.dragOver(poDropZones[0]);
      fireEvent.dragLeave(poDropZones[0]);
      fireEvent.drop(poDropZones[0], { dataTransfer: { files: [] } });
      fireEvent.drop(poDropZones[0], { dataTransfer: { files: [invalidFile] } });
      expect(mockShowToast).toHaveBeenCalledWith(
        'Unsupported File Type',
        expect.stringContaining('not a supported spreadsheet file'),
        'warning'
      );
    }

    // Step 4: Run AI cross match with mock response
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            vendorCode: 'V-001',
            vendorName: 'Larsen & Toubro',
            suggestedMajorCategory: 'Civil Infrastructure',
            suggestedMinorCategories: ['PEB Structures', 'Piping'],
            confidenceScore: 92,
            reasoning: 'Extracted from historical infrastructure PO items',
            engine: 'Google Gemini Pro ERP',
            status: 'mapped',
          },
          {
            vendorCode: 'V-002',
            vendorName: 'Adani Infra',
            suggestedMajorCategory: '',
            suggestedMinorCategories: [],
            confidenceScore: 35,
            reasoning: 'Unmapped spend pattern',
            engine: 'Neural Taxonomy Engine',
            status: 'unmapped',
          },
        ],
      }),
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/Run AI Category Cross-Match/i));
    });

    expect(screen.getByText(/Step 4: AI Cross-Match/i)).toBeInTheDocument();

    // Test Category Review Tabs: 'all', 'mapped', 'unmapped'
    const unmappedTabs = screen.getAllByRole('button', { name: /Unmapped/i });
    if (unmappedTabs.length > 0) fireEvent.click(unmappedTabs[0]);

    const mappedTabs = screen.getAllByRole('button', { name: /Mapped/i });
    if (mappedTabs.length > 0) fireEvent.click(mappedTabs[0]);

    const allTabs = screen.getAllByRole('button', { name: /All \(/i });
    if (allTabs.length > 0) fireEvent.click(allTabs[0]);

    // Open Manual Category Override Drawer
    const editBtns = screen.getAllByRole('button', { name: /Edit/i });
    if (editBtns.length > 0) {
      fireEvent.click(editBtns[0]);
      // Verify override modal / drawer is visible
      const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelBtn);

      // Re-open and save manual override
      fireEvent.click(editBtns[0]);
      const saveBtn = screen.getByRole('button', { name: /Save Override/i });
      fireEvent.click(saveBtn);
    }

    // Proceed to Step 5
    fireEvent.click(screen.getByText(/Review Email Dispatch & Finalize/i));
    expect(screen.getByText(/Step 5: Confirm Ingestion/i)).toBeInTheDocument();

    // Save Ingestion
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, count: 2 }) });

    await act(async () => {
      fireEvent.click(screen.getByText(/COMPLETE SETUP & INGEST/i));
    });

    expect(mockProcessHistoricalPurchaseData).toHaveBeenCalled();
  });
});



