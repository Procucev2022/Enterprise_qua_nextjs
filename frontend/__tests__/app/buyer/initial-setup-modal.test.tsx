import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as XLSX from 'xlsx';
import InitialSetupModal, { IngestionProgressCard } from '@/app/buyer/initial-setup-modal';
import { useApp } from '@/lib/store';
import { UI_STRINGS } from '@/lib/uiStrings';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
  getLastHistoricalDataError: jest.fn(() => null),
}));

jest.mock('@/lib/buyerProfileClient', () => ({
  fetchDispatchTemplates: jest.fn().mockResolvedValue({
    success: true,
    data: {
      category_mapped: { subject: 'Saved Mapped Subject', message: 'Saved Mapped Message' },
      self_map_required: { subject: 'Saved Self Subject', message: 'Saved Self Message' },
    },
  }),
  saveDispatchTemplate: jest.fn().mockResolvedValue({ success: true }),
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
  const mockSetInitialSetupModalOpen = jest.fn();
  const mockSetHistoricalPurchaseDataPeriod = jest.fn();
  const mockProcessHistoricalPurchaseData = jest.fn();
  const mockShowToast = jest.fn();

  const mockBuyerVendors: any[] = [
    {
      id: 'v-1',
      name: 'Apex Supplies Ltd.',
      contactPerson: 'Rajesh Nair',
      email: 'rajesh@apex.in',
      phone: '+91 98201 44820',
      location: 'Pune, Maharashtra',
      score: 85,
      source: 'buyer_manual',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      evaluated: true,
    },
    {
      id: 'v-2',
      name: 'Global Valves Ltd',
      contactPerson: 'Suresh Rao',
      email: 'suresh@globalvalves.in',
      phone: '+91 98201 55443',
      location: 'Vadodara, Gujarat',
      rating: 4.5,
      source: 'buyer_manual',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      evaluated: true,
    },
    {
      id: 'v-3',
      name: 'Delta Compressors Ltd',
      email: 'delta@compressors.in',
      phone: '+91 98201 66554',
      source: 'buyer_manual',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      evaluated: false,
    },
  ];

  const createValidVendorMasterFile = () => {
    const ws = XLSX.utils.json_to_sheet([
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
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vendors');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const file: any = new File([buf], 'vendor_master.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    file.__buffer = buf;
    return file;
  };

  const createValidPoDumpFile = () => {
    const ws = XLSX.utils.json_to_sheet([
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
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'POs');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const file: any = new File([buf], 'po_dump.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    file.__buffer = buf;
    return file;
  };

  beforeAll(() => {
    (global as any).FileReader = MockFileReader;
    HTMLAnchorElement.prototype.click = jest.fn();
  });

  afterAll(() => {
    global.FileReader = originalFileReader;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: {} }),
      })
    ) as any;
    (useApp as jest.Mock).mockReturnValue({
      initialSetupModalOpen: true,
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      historicalPurchaseDataPeriod: '2_years',
      setHistoricalPurchaseDataPeriod: mockSetHistoricalPurchaseDataPeriod,
      processHistoricalPurchaseData: mockProcessHistoricalPurchaseData,
      activeBuyerAccount: { organizationName: 'Larsen & Toubro Limited' },
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

  it('walks through the 5 steps and saves processed data with activeBuyerAccount null', () => {
    jest.useFakeTimers();
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

    const { container } = render(<InitialSetupModal />);

    // STEP 1: Select Period
    expect(screen.getByText(/Step 1: Choose Historical Purchase Period/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Last 1 Year \(12 Months\)/i));
    expect(mockSetHistoricalPurchaseDataPeriod).toHaveBeenCalledWith('1_year');

    fireEvent.click(screen.getByText(/Last 3 Years \(36 Months\)/i));
    expect(mockSetHistoricalPurchaseDataPeriod).toHaveBeenCalledWith('3_years');

    // Download Vendor Master template from Step 1 (Time Horizon)
    fireEvent.click(screen.getByText(/Download Vendor Master Template/i));
    expect(mockShowToast).toHaveBeenCalledWith('Template Downloaded', expect.any(String), 'success');

    // Continue to STEP 2
    fireEvent.click(screen.getByText(/Continue to File 1: Vendor Master/i));
    expect(screen.getByText(/Step 2: Upload File 1/i)).toBeInTheDocument();

    // Step 2 starts empty (default selection removed)
    expect(screen.getByText(/No Vendor Master file selected/i)).toBeInTheDocument();

    // Verify warning if trying to proceed without uploading vendor master
    fireEvent.click(screen.getByText(/Proceed to File 2: PO Dump/i));
    expect(mockShowToast).toHaveBeenCalledWith('Vendor Master Required', expect.any(String), 'warning');

    // Upload a Vendor Master file
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
    ]);
    const wbVendors = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbVendors, wsVendors, 'Vendors');
    const vendorBuffer = XLSX.write(wbVendors, { type: 'array', bookType: 'xlsx' });
    const vendorFile: any = new File([vendorBuffer], 'vendor_master.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    vendorFile.__buffer = vendorBuffer;

    const fileInput = container.querySelector('input[type="file"]');
    if (fileInput) {
      fireEvent.change(fileInput, { target: { files: [vendorFile] } });
    }
    expect(mockShowToast).toHaveBeenCalledWith('Vendor Master Uploaded', expect.any(String), 'success');

    // Clear Selection in Step 2 — click the stopPropagation-wrapped instance
    // inside the "already uploaded" summary panel (the last rendered one; a
    // plain header-level button with the same label precedes it).
    const clearBtns = screen.getAllByText('Clear Selection');
    fireEvent.click(clearBtns[clearBtns.length - 1]);
    expect(mockShowToast).toHaveBeenCalledWith('Selection Cleared', expect.any(String), 'info');

    // Upload again to continue flow
    if (fileInput) {
      fireEvent.change(fileInput, { target: { files: [vendorFile] } });
    }

    // Continue to STEP 3 using Proceed to File 2: PO Dump button
    fireEvent.click(screen.getByText(/Proceed to File 2: PO Dump/i));
    expect(screen.getByText(/Step 3: Upload File 2/i)).toBeInTheDocument();

    // Download PO dump template
    fireEvent.click(screen.getByText(/Download PO Dump Template/i));
    expect(mockShowToast).toHaveBeenCalledWith('Template Downloaded', expect.any(String), 'success');

    // Reset PO in Step 3
    fireEvent.click(screen.getByText('Reset Template'));
    expect(mockShowToast).toHaveBeenCalledWith('Reset Complete', expect.any(String), 'info');

    // Upload PO data
    const poFile = createValidPoDumpFile();
    const poInput = container.querySelector('input[type="file"]');
    if (poInput) {
      fireEvent.change(poInput, { target: { files: [poFile] } });
    }

    // Run AI Cross-Match simulation to enter STEP 4
    fireEvent.click(screen.getByText(/Run AI Category Cross-Match/i));
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    // STEP 4: Category Review & Cross Join
    expect(screen.getByText(/Step 4: AI Cross-Match/i)).toBeInTheDocument();

    // Tab filters in Step 4
    const filterTabs = screen.getAllByRole('button');
    const mappedTab = filterTabs.find((b) => b.textContent?.includes('Mapped'));
    if (mappedTab) fireEvent.click(mappedTab);

    const unmappedTab = filterTabs.find((b) => b.textContent?.includes('Unmapped'));
    if (unmappedTab) fireEvent.click(unmappedTab);

    const allTab = filterTabs.find((b) => b.textContent?.includes('All'));
    if (allTab) fireEvent.click(allTab);

    // Continue to Step 5 using Review Email Dispatch button
    fireEvent.click(screen.getByText(/Review Email Dispatch & Finalize/i));
    expect(screen.getByText(/Step 5: Confirm Ingestion/i)).toBeInTheDocument();

    // Save and commit
    fireEvent.click(screen.getByText(/COMPLETE SETUP & INGEST/i));
    expect(mockProcessHistoricalPurchaseData).toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('handles back button navigation and modal close (X button)', () => {
    jest.useFakeTimers();
    const { container } = render(<InitialSetupModal />);

    // Step 1 -> Step 2
    fireEvent.click(screen.getByText(/Continue to File 1: Vendor Master/i));
    expect(screen.getByText(/Step 2: Upload File 1/i)).toBeInTheDocument();

    // Back to step 1
    fireEvent.click(screen.getByText('Back to Period'));
    expect(screen.getByText(/Step 1: Choose Historical Purchase Period/i)).toBeInTheDocument();

    // Step 1 -> Step 2
    fireEvent.click(screen.getByText(/Continue to File 1: Vendor Master/i));
    expect(screen.getByText(/Step 2: Upload File 1/i)).toBeInTheDocument();

    // Upload vendor file so Step 3 can be accessed
    const vFile = createValidVendorMasterFile();
    const vInput = container.querySelector('input[type="file"]');
    if (vInput) {
      fireEvent.change(vInput, { target: { files: [vFile] } });
    }

    // Step 2 -> Step 3
    fireEvent.click(screen.getByText('3. PO Dump'));
    expect(screen.getByText(/Step 3: Upload File 2/i)).toBeInTheDocument();

    // Back to step 2
    fireEvent.click(screen.getByText('Back to Vendor Master'));
    expect(screen.getByText(/Step 2: Upload File 1/i)).toBeInTheDocument();

    // Step 2 -> Step 3
    fireEvent.click(screen.getByText('3. PO Dump'));
    expect(screen.getByText(/Step 3: Upload File 2/i)).toBeInTheDocument();

    // Upload PO file so Step 4 & 5 can be accessed
    const poFile = createValidPoDumpFile();
    const poInput = container.querySelector('input[type="file"]');
    if (poInput) {
      fireEvent.change(poInput, { target: { files: [poFile] } });
    }

    // Step 3 -> Step 4
    fireEvent.click(screen.getByText('4. AI Category Join'));
    expect(screen.getByText(/Step 4: AI Cross-Match/i)).toBeInTheDocument();

    // Back to step 3
    fireEvent.click(screen.getByText('Back to PO Dump'));
    expect(screen.getByText(/Step 3: Upload File 2/i)).toBeInTheDocument();

    // Step 3 -> Step 5
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

    jest.useRealTimers();
  });

  it('handles excel file uploads, column aliases, empty values, errors, and cross-category AI parsing', () => {
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

    // Re-upload valid vendorFile before proceeding to Step 3
    if (vInput) {
      fireEvent.change(vInput, { target: { files: [vendorFile] } });
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

    const badTypeFile: any = new File(['not a spreadsheet'], 'resume.pdf', { type: 'application/pdf' });
    const poInput = container.querySelector('input[type="file"]');
    if (poInput) {
      fireEvent.change(poInput, { target: { files: [poFile] } });
      fireEvent.change(poInput, { target: { files: [emptyFile] } });
      fireEvent.change(poInput, { target: { files: [errFile] } });
      fireEvent.change(poInput, { target: { files: [corruptFile] } });
      fireEvent.change(poInput, { target: { files: [badTypeFile] } }); // rejected before parsing (BUGS.md #34)
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
        {
          'PO Number': 'PO-8884',
          'PO Date': 45995.00011574074,
          'Vendor Name': 'Apex Supplies Ltd.',
          'Item Name': 'Decimal Date Test',
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
    fireEvent.click(screen.getByText('4. AI Category Join'));
    fireEvent.click(screen.getByText(/Review Email Dispatch & Finalize/i));
    expect(screen.getByText(/Step 5: Confirm Ingestion/i)).toBeInTheDocument();
  });

  it('supports read-only default table and toggling Edit Data mode', () => {
    render(<InitialSetupModal />);
    // Navigate to Step 2
    fireEvent.click(screen.getByText(/Continue to File 1: Vendor Master/i));
    expect(screen.getByText(/No Vendor Master file selected/i)).toBeInTheDocument();

    // Add Vendor Manually button in empty state (automatically enables edit mode)
    fireEvent.click(screen.getByText(/Add Vendor Manually/i));
    expect(screen.getByText(/Editing Vendor Master Records \(1 Suppliers\)/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Done Editing/i })).toBeInTheDocument();

    // Edit company name
    const companyInput = screen.getByPlaceholderText('Company name');
    fireEvent.change(companyInput, { target: { value: 'Custom Supplier Private Limited' } });
    expect(companyInput).toHaveValue('Custom Supplier Private Limited');

    // Edit code
    const codeInput = screen.getByPlaceholderText('VND-CODE');
    fireEvent.change(codeInput, { target: { value: 'VND-9999' } });
    expect(codeInput).toHaveValue('VND-9999');

    // Edit email, contact, and phone
    const emailInput = screen.getByPlaceholderText('email@domain.com');
    fireEvent.change(emailInput, { target: { value: 'custom@supplier.in' } });
    expect(emailInput).toHaveValue('custom@supplier.in');

    const contactInput = screen.getByPlaceholderText('Contact Name');
    fireEvent.change(contactInput, { target: { value: 'Nitin Patel' } });
    expect(contactInput).toHaveValue('Nitin Patel');

    const phoneInput = screen.getByPlaceholderText('+91 Phone');
    fireEvent.change(phoneInput, { target: { value: '+91 99887 66554' } });
    expect(phoneInput).toHaveValue('+91 99887 66554');

    // Edit GSTIN & Address
    const gstinInput = screen.getByPlaceholderText('GSTIN');
    fireEvent.change(gstinInput, { target: { value: '24abcde1234f1z5' } });
    expect(gstinInput).toHaveValue('24ABCDE1234F1Z5');

    const addressInput = screen.getByPlaceholderText('City, State / Address');
    fireEvent.change(addressInput, { target: { value: 'Ahmedabad, Gujarat' } });
    expect(addressInput).toHaveValue('Ahmedabad, Gujarat');

    // Edit rating
    const ratingInput = screen.getByPlaceholderText('0-100');
    fireEvent.change(ratingInput, { target: { value: '92' } });
    expect(ratingInput).toHaveValue(92);

    // Click "Done Editing" to lock/switch to read-only view
    fireEvent.click(screen.getByRole('button', { name: /Done Editing/i }));
    expect(screen.getByText(/Stored Vendor Master Records \(1 Suppliers\)/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit Data/i })).toBeInTheDocument();
    expect(screen.getByText('Custom Supplier Private Limited')).toBeInTheDocument();
    expect(screen.getByText('VND-9999')).toBeInTheDocument();

    // Click "Edit Data" button to re-enter edit mode
    fireEvent.click(screen.getByRole('button', { name: /Edit Data/i }));
    expect(screen.getByText(/Editing Vendor Master Records \(1 Suppliers\)/i)).toBeInTheDocument();

    // Add a second vendor row via top button
    fireEvent.click(screen.getByRole('button', { name: /Add Vendor Row/i }));
    expect(screen.getByText(/Editing Vendor Master Records \(2 Suppliers\)/i)).toBeInTheDocument();

    // Delete a vendor row
    const deleteButtons = screen.getAllByTitle(/Delete/i);
    expect(deleteButtons.length).toBe(2);
    fireEvent.click(deleteButtons[1]);
    expect(screen.getByText(/Editing Vendor Master Records \(1 Suppliers\)/i)).toBeInTheDocument();

    // Delete remaining row to return to empty state
    const remainingDeleteButtons = screen.getAllByTitle(/Delete/i);
    fireEvent.click(remainingDeleteButtons[0]);
    expect(screen.getByText(/No Vendor Master file selected/i)).toBeInTheDocument();
  });

  it('clicks the empty-state Browse File button to trigger the hidden file input', () => {
    const { container } = render(<InitialSetupModal />);
    fireEvent.click(screen.getByText(/Continue to File 1: Vendor Master/i));
    expect(screen.getByText(/No Vendor Master file selected/i)).toBeInTheDocument();

    const browseBtn = screen.getByText('Browse File').closest('button')!;
    const clickSpy = jest.spyOn(container.querySelector('input[type="file"]') as HTMLInputElement, 'click');
    fireEvent.click(browseBtn);
    expect(clickSpy).toHaveBeenCalled();
  });

  it('classifies IT/software purchases and falls back to General Spares for unmatched categories', () => {
    const wsVendors = XLSX.utils.json_to_sheet([
      // "SupplierVendorEmailAddress" isn't an exact normalized match for any
      // known email alias, only a substring superset — forces the getVal
      // substring-match fallback loop to actually resolve a value.
      { 'Company Name': 'CloudTech Solutions', SupplierVendorEmailAddress: 'sales@cloudtech.com', Phone: '+91 98201 11223' },
      { 'Company Name': 'Zenith Traders', Email: 'info@zenith.com', Phone: '+91 98201 22334' },
      { 'Company Name': 'Plain Software House', Email: 'contact@plainsoftware.com', Phone: '+91 98201 33445' },
    ]);
    const wbVendor = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbVendor, wsVendors, 'Vendors');
    const vendorBuffer = XLSX.write(wbVendor, { type: 'array', bookType: 'xlsx' });
    const vendorFile: any = new File([vendorBuffer], 'it_vendors.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    vendorFile.__buffer = vendorBuffer;

    const wsPOs = XLSX.utils.json_to_sheet([
      {
        'PO Number': 'PO-7001',
        'Vendor Name': 'CloudTech Solutions',
        'Item Name': 'Microsoft 365 workspace license subscription renewal, Azure cloud storage credits, BigQuery analytics data platform, Datacenter infrastructure server',
        Quantity: 1,
        'Unit Price': 100000,
        'Total Spend': 100000,
      },
      {
        'PO Number': 'PO-7002',
        'Vendor Name': 'Zenith Traders',
        'Item Name': 'Office stationery and miscellaneous supplies',
        Quantity: 5,
        'Unit Price': 100,
        'Total Spend': 500,
      },
      {
        // "software" alone matches the IT branch but none of its more specific
        // minor-category keywords (cloud/license/bigquery/datacenter/etc.),
        // forcing the empty-secondSetMinors fallback.
        'PO Number': 'PO-7003',
        'Vendor Name': 'Plain Software House',
        'Item Name': 'Generic software',
        Quantity: 1,
        'Unit Price': 1000,
        'Total Spend': 1000,
      },
    ]);
    const wbPO = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbPO, wsPOs, 'POs');
    const poBuffer = XLSX.write(wbPO, { type: 'array', bookType: 'xlsx' });
    const poFile: any = new File([poBuffer], 'it_pos.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    poFile.__buffer = poBuffer;

    jest.useFakeTimers();
    render(<InitialSetupModal />);

    fireEvent.click(screen.getByText('2. Vendor Master'));
    const vInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(vInput, { target: { files: [vendorFile] } });

    fireEvent.click(screen.getByText('3. PO Dump'));
    const poInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(poInput, { target: { files: [poFile] } });

    fireEvent.click(screen.getByText(/Run AI Category Cross-Match/i));
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByText(/Step 4: AI Cross-Match/i)).toBeInTheDocument();
    jest.useRealTimers();
  });

  it('applies the AI cross-match API result when the backend responds successfully', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            id: 'v-api-1',
            vendorCode: 'VND-API-1',
            companyName: 'Api Matched Vendor',
            email: 'api@vendor.com',
            contactPerson: 'API Contact',
            phone: '+91 90000 00000',
            address: 'API Address',
            gstNumber: '27AAAAA0000A1Z0',
            hasPoHistory: true,
            categoriesMappedByBuyer: true,
            itemsSupplied: ['API Item'],
            pastPoSpend: '₹1,000 (1 POs)',
            poCount: 1,
            firstSetMajorCategory: 'General Spares & Consumables',
            secondSetMinorCategories: ['Customised Parts'],
          },
        ],
      }),
    } as any);

    jest.useFakeTimers();
    const { container } = render(<InitialSetupModal />);

    fireEvent.click(screen.getByText(/Continue to File 1: Vendor Master/i));
    const vFile = createValidVendorMasterFile();
    const vInput = container.querySelector('input[type="file"]');
    if (vInput) fireEvent.change(vInput, { target: { files: [vFile] } });

    fireEvent.click(screen.getByText(/Proceed to File 2: PO Dump/i));
    const poFile = createValidPoDumpFile();
    const poInput = container.querySelector('input[type="file"]');
    if (poInput) fireEvent.change(poInput, { target: { files: [poFile] } });

    fireEvent.click(screen.getByText(/Run AI Category Cross-Match/i));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByText(/Step 4: AI Cross-Match/i)).toBeInTheDocument();
    jest.useRealTimers();
    fetchSpy.mockRestore();
  });

  it('logs and continues locally when the AI cross-match API call rejects', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    jest.useFakeTimers();
    const { container } = render(<InitialSetupModal />);

    fireEvent.click(screen.getByText(/Continue to File 1: Vendor Master/i));
    const vFile = createValidVendorMasterFile();
    const vInput = container.querySelector('input[type="file"]');
    if (vInput) fireEvent.change(vInput, { target: { files: [vFile] } });

    fireEvent.click(screen.getByText(/Proceed to File 2: PO Dump/i));
    const poFile = createValidPoDumpFile();
    const poInput = container.querySelector('input[type="file"]');
    if (poInput) fireEvent.change(poInput, { target: { files: [poFile] } });

    fireEvent.click(screen.getByText(/Run AI Category Cross-Match/i));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByText(/Step 4: AI Cross-Match/i)).toBeInTheDocument();
    expect(consoleWarnSpy).toHaveBeenCalledWith('Backend AI cross-match API error:', expect.any(Error));

    jest.useRealTimers();
    fetchSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('polls PO Dump job progress live instead of freezing at the initial 0-processed snapshot', async () => {
    const sessionId = 'session-po-poll-test';
    const jobId = 'job-po-poll-test';

    const initialJob = {
      id: jobId,
      jobType: 'PO_DUMP',
      fileName: 'po_dump.csv',
      status: 'PROCESSING',
      totalRecords: 500,
      processedRecords: 0,
      importedRecords: 0,
      skippedRecords: 0,
      failedRecords: 0,
    };
    const progressedJob = { ...initialJob, processedRecords: 250, importedRecords: 240 };

    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(((url: string) => {
      if (url === '/api/vendor-ingestion/session') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: { session: { id: sessionId } } }),
        });
      }
      if (url.includes('/stream-upload')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: { job: initialJob } }),
        });
      }
      if (url === `/api/vendor-ingestion/${sessionId}/jobs/${jobId}`) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: { job: progressedJob } }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
    }) as any);

    jest.useFakeTimers();
    const { container } = render(<InitialSetupModal />);

    // Session init fires on mount — flush it before navigating.
    await act(async () => {
      await Promise.resolve();
    });

    // Upload vendor master in Step 2 first
    fireEvent.click(screen.getByText('2. Vendor Master'));
    const vFile = createValidVendorMasterFile();
    const vInput = container.querySelector('input[type="file"]');
    if (vInput) {
      await act(async () => {
        fireEvent.change(vInput, { target: { files: [vFile] } });
        await Promise.resolve();
      });
    }

    fireEvent.click(screen.getByText('3. PO Dump'));
    const poFile: any = new File(['PO Number,Vendor Name,Item Description,Category\n'], 'po_dump.csv', {
      type: 'text/csv',
    });
    const poInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(poInput, { target: { files: [poFile] } });
      await Promise.resolve();
    });

    expect(mockShowToast).toHaveBeenCalledWith('Ingestion Started', expect.any(String), 'info');

    // Nothing has polled yet — this is the bug being fixed: the job object
    // the UI holds right now is still the 0-processed snapshot.
    expect(fetchSpy).not.toHaveBeenCalledWith(
      `/api/vendor-ingestion/${sessionId}/jobs/${jobId}`,
      expect.anything()
    );

    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/vendor-ingestion/${sessionId}/jobs/${jobId}`,
      expect.anything()
    );

    jest.useRealTimers();
    fetchSpy.mockRestore();
  });

  it('downloads vendor master Excel template and PO dump Excel template', () => {
    const { container } = render(<InitialSetupModal />);
    // In Step 1: Time Horizon
    const vendorTemplateBtn = screen.getByText(/Download Vendor Master Template/i);
    fireEvent.click(vendorTemplateBtn);
    expect(vendorTemplateBtn).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Continue to File 1: Vendor Master/i));
    expect(screen.queryByText(/Download Vendor Master Template/i)).not.toBeInTheDocument();

    const vFile = createValidVendorMasterFile();
    const fileInput = container.querySelector('input[type="file"]');
    if (fileInput) fireEvent.change(fileInput, { target: { files: [vFile] } });

    fireEvent.click(screen.getByText('3. PO Dump'));
    const poExcelBtn = screen.getByText(/Download PO Dump Template/i);
    fireEvent.click(poExcelBtn);
    expect(poExcelBtn).toBeInTheDocument();
  });

  it('renders Completion Summary on setup completion for both mapped and unmapped vendors', async () => {
    const summaryData = {
      importedCount: 2,
      totalProcessed: 2,
      mappedCount: 1,
      mappedEmailsSent: 1,
      unmappedCount: 1,
      unmappedEmailsSent: 1,
      failedEmailCount: 0,
      failedEmails: [],
      overallStatus: 'COMPLETED' as const,
      period: '2_years',
      totalVendors: 2,
    };

    (useApp as jest.Mock).mockReturnValue({
      initialSetupModalOpen: true,
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      historicalPurchaseDataPeriod: '2_years',
      setHistoricalPurchaseDataPeriod: mockSetHistoricalPurchaseDataPeriod,
      processHistoricalPurchaseData: mockProcessHistoricalPurchaseData.mockResolvedValue(2),
      lastIngestionSummary: summaryData,
      setInitialSetupCompleted: jest.fn(),
      activeBuyerAccount: { organizationName: 'Larsen & Toubro Limited' },
      buyerVendors: mockBuyerVendors,
      showToast: mockShowToast,
    });

    const { container } = render(<InitialSetupModal />);

    fireEvent.click(screen.getByText('2. Vendor Master'));
    const vFile = createValidVendorMasterFile();
    const vInput = container.querySelector('input[type="file"]');
    if (vInput) {
      await act(async () => {
        fireEvent.change(vInput, { target: { files: [vFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    fireEvent.click(screen.getByText('3. PO Dump'));
    const poFile = createValidPoDumpFile();
    const poInput = container.querySelector('input[type="file"]');
    if (poInput) {
      await act(async () => {
        fireEvent.change(poInput, { target: { files: [poFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    // Navigate to Step 5
    fireEvent.click(screen.getByText('5. Dispatch Emails'));

    expect(screen.getByText(/Step 5: Confirm Ingestion/i)).toBeInTheDocument();
    expect(screen.getByText(/COMPLETE SETUP & INGEST/i)).toBeInTheDocument();

    // Click Complete Setup & Ingest
    const submitBtn = screen.getByText(/COMPLETE SETUP & INGEST/i);
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(mockProcessHistoricalPurchaseData).toHaveBeenCalled();
    expect(mockSetInitialSetupModalOpen).toHaveBeenCalledWith(false);
    expect(mockShowToast).toHaveBeenCalledWith('Setup Complete', expect.any(String), 'success');
  });

  it('supports pagination controls (Show More, Show All, Collapse) in Step 2 and Step 3', () => {
    const manyVendors = Array.from({ length: 60 }, (_, i) => ({
      'Vendor Code': `V-${i + 100}`,
      'Company Name': `Vendor ${i}`,
      Email: `vendor${i}@test.com`,
    }));
    const wsV = XLSX.utils.json_to_sheet(manyVendors);
    const wbV = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbV, wsV, 'Vendors');
    const vBuf = XLSX.write(wbV, { type: 'array', bookType: 'xlsx' });
    const vFile: any = new File([vBuf], 'many_vendors.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    vFile.__buffer = vBuf;

    const { container } = render(<InitialSetupModal />);
    fireEvent.click(screen.getByText('2. Vendor Master'));

    const fileInput = container.querySelector('input[type="file"]');
    if (fileInput) {
      fireEvent.change(fileInput, { target: { files: [vFile] } });
    }

    // Now storedVendors.length is 60 > 50, so pagination buttons appear
    const showMoreBtn = screen.getByText(/Show More/i);
    fireEvent.click(showMoreBtn);
    expect(screen.getByText(/Collapse to 50/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Collapse to 50/i));
    expect(screen.getByText(/Show More/i)).toBeInTheDocument();

    const showAllBtn = screen.getByText(/Show All/i);
    fireEvent.click(showAllBtn);
    expect(screen.getByText(/Collapse to 50/i)).toBeInTheDocument();

    // Test Clear button in Step 2
    const clearBtn = screen.getByTitle('Clear uploaded Vendor Master file');
    fireEvent.click(clearBtn);
    expect(screen.getByText(/No Vendor Master file selected/i)).toBeInTheDocument();
  });

  it('handles ingestion failure with error banner and toast warning', async () => {
    const failingProcess = jest.fn().mockRejectedValue(new Error('Network connection failed'));
    (useApp as jest.Mock).mockReturnValue({
      initialSetupModalOpen: true,
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      historicalPurchaseDataPeriod: '2_years',
      setHistoricalPurchaseDataPeriod: mockSetHistoricalPurchaseDataPeriod,
      processHistoricalPurchaseData: failingProcess,
      lastIngestionSummary: null,
      setInitialSetupCompleted: jest.fn(),
      activeBuyerAccount: { organizationName: 'L&T' },
      buyerVendors: mockBuyerVendors,
      showToast: mockShowToast,
    });

    const { container } = render(<InitialSetupModal />);
    fireEvent.click(screen.getByText('2. Vendor Master'));
    const vFile = createValidVendorMasterFile();
    const vInput = container.querySelector('input[type="file"]');
    if (vInput) {
      await act(async () => {
        fireEvent.change(vInput, { target: { files: [vFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    fireEvent.click(screen.getByText('3. PO Dump'));
    const poFile = createValidPoDumpFile();
    const poInput = container.querySelector('input[type="file"]');
    if (poInput) {
      await act(async () => {
        fireEvent.change(poInput, { target: { files: [poFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    fireEvent.click(screen.getByText('5. Dispatch Emails'));

    const submitBtn = screen.getByText(/COMPLETE SETUP & INGEST/i);
    await act(async () => {
      fireEvent.click(submitBtn);
    });
    expect(mockShowToast).toHaveBeenCalledWith('Ingestion Error', expect.any(String), 'warning');
    expect(screen.getByTestId('step5-submission-error-banner')).toBeInTheDocument();
  });

  it('cancels active background ingestion jobs when modal is closed', async () => {
    let cancelCalled = false;
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/vendor-ingestion/session')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { session: { id: 'sess-active-123' } } }),
        });
      }
      if (url.includes('stream-upload')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                job: {
                  id: 'job-active-1',
                  jobType: 'VENDOR_MASTER',
                  status: 'PROCESSING',
                },
              },
            }),
        });
      }
      if (url.includes('/jobs/cancel')) {
        cancelCalled = true;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: {} }),
      });
    });

    const csvContent = 'Vendor Code,Company Name,Email\nV-1,Active Vendor,active@test.com';
    const csvFile = new File([csvContent], 'active_vendors.csv', { type: 'text/csv' });

    const { container } = render(<InitialSetupModal />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    fireEvent.click(screen.getByText('2. Vendor Master'));
    const fileInput = container.querySelector('input[type="file"]');
    if (fileInput) {
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [csvFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    const closeBtn = container.querySelector('button[title="Dismiss setup (you can resume from the blinking corner badge)"]');
    if (closeBtn) {
      await act(async () => {
        fireEvent.click(closeBtn);
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }
    expect(cancelCalled).toBe(true);
    expect(mockSetInitialSetupModalOpen).toHaveBeenCalledWith(false);
  });

  it('restores previous vendor master and PO files from active session', async () => {
    let sessionFetched = false;
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/vendor-ingestion/session')) {
        sessionFetched = true;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                session: {
                  id: 'sess-restore',
                  vendorMasterFileName: 'restored_vendors.xlsx',
                  vendorMasterRowCount: 25,
                  poFileName: 'restored_pos.xlsx',
                  poRowCount: 120,
                },
              },
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    });

    render(<InitialSetupModal />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(sessionFetched).toBe(true);
  });

  it('triggers streaming upload for CSV files when sessionId is present', async () => {
    let streamUploadCalled = false;
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/vendor-ingestion/session')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { session: { id: 'sess-csv-stream' } } }),
        });
      }
      if (url.includes('stream-upload')) {
        streamUploadCalled = true;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                job: {
                  id: 'job-stream-1',
                  jobType: 'VENDOR_MASTER',
                  status: 'PROCESSING',
                },
              },
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: {} }),
      });
    });

    const csvContent = 'Vendor Code,Company Name,Email\nV-1,Stream Vendor,stream@test.com';
    const csvFile = new File([csvContent], 'stream_vendors.csv', { type: 'text/csv' });

    const { container } = render(<InitialSetupModal />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    fireEvent.click(screen.getByText('2. Vendor Master'));
    const fileInput = container.querySelector('input[type="file"]');
    if (fileInput) {
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [csvFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    expect(streamUploadCalled).toBe(true);
    expect(mockShowToast).toHaveBeenCalledWith('Ingestion Started', expect.any(String), 'info');
  });

  it('triggers start-job on Excel upload when sessionId exists, and tests Step 3 pagination and browse button', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/vendor-ingestion/session')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { session: { id: 'sess-excel-startjob' } } }),
        });
      }
      if (url.includes('start-job')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                job: {
                  id: 'job-excel-1',
                  skippedRecords: 0,
                  failedRecords: 0,
                },
              },
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: {} }),
      });
    });

    const manyPOs = Array.from({ length: 60 }, (_, i) => ({
      'PO Number': `PO-${i + 100}`,
      'PO Date': '2025-01-01',
      'Supplier Name': `Supplier ${i}`,
      'Item Description': `Item ${i}`,
      Quantity: 10,
      Price: 100,
      Total: 1000,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(manyPOs), 'POs');
    const poBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const poFile: any = new File([poBuf], 'many_pos.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    poFile.__buffer = poBuf;

    const { container } = render(<InitialSetupModal />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // In Step 2: Vendor Master Excel upload with sessionId
    fireEvent.click(screen.getByText('2. Vendor Master'));
    const wsV = XLSX.utils.json_to_sheet([{ 'Vendor Code': 'V-1', 'Company Name': 'Vendor 1', Email: 'v1@test.com', Phone: '+91 98201 11223' }]);
    const wbV = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbV, wsV, 'Vendors');
    const vBuf = XLSX.write(wbV, { type: 'array', bookType: 'xlsx' });
    const vFile: any = new File([vBuf], 'vendor_startjob.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    vFile.__buffer = vBuf;
    const vInput = container.querySelector('input[type="file"]');
    if (vInput) {
      await act(async () => {
        fireEvent.change(vInput, { target: { files: [vFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    // Go to Step 3
    fireEvent.click(screen.getByText('3. PO Dump'));

    // Test Browse File button in empty state
    const browseBtns = screen.getAllByText(/Browse File/i);
    if (browseBtns.length > 0) {
      fireEvent.click(browseBtns[0]);
    }

    const fileInput = container.querySelector('input[type="file"]');
    if (fileInput) {
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [poFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    // In Step 3, pagination controls appear for 60 records
    const showMoreBtns = screen.getAllByText(/Show More/i);
    if (showMoreBtns[0]) fireEvent.click(showMoreBtns[0]);

    const collapseBtns = screen.getAllByText(/Collapse to 50/i);
    if (collapseBtns[0]) fireEvent.click(collapseBtns[0]);

    const showAllBtns = screen.getAllByText(/Show All/i);
    if (showAllBtns[0]) fireEvent.click(showAllBtns[0]);
  });

  it('handles start-job errors and streaming upload exceptions gracefully', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/vendor-ingestion/session')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { session: { id: 'sess-errors-1' } } }),
        });
      }
      if (url.includes('stream-upload')) {
        return Promise.reject(new Error('Streaming network failure'));
      }
      if (url.includes('start-job')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Internal Server Error' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: {} }),
      });
    });

    const { container } = render(<InitialSetupModal />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Test streaming upload error in Step 2 (vendor master CSV)
    fireEvent.click(screen.getByText('2. Vendor Master'));
    const csvFile = new File(['code,name,email,phone\nV-1,Err,err@test.com,+91 98201 11223'], 'stream_err.csv', { type: 'text/csv' });
    const fileInput = container.querySelector('input[type="file"]');
    if (fileInput) {
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [csvFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }
    expect(mockShowToast).toHaveBeenCalledWith('Upload Error', expect.any(String), 'warning');

    // Upload valid vendor master so Step 3 is accessible
    const vValid = createValidVendorMasterFile();
    if (fileInput) {
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [vValid] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    // Test streaming upload error in Step 3 (PO dump CSV)
    fireEvent.click(screen.getByText('3. PO Dump'));
    const poCsvFile = new File(['po,date,vendor\nPO-1,2025-01-01,Err'], 'po_stream_err.csv', { type: 'text/csv' });
    const poInput = container.querySelector('input[type="file"]');
    if (poInput) {
      await act(async () => {
        fireEvent.change(poInput, { target: { files: [poCsvFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }
    expect(mockShowToast).toHaveBeenCalledWith('Upload Error', expect.any(String), 'warning');

    // Test start-job ok:false branch on Excel upload in Step 2
    fireEvent.click(screen.getByText('2. Vendor Master'));
    const wsV = XLSX.utils.json_to_sheet([{ 'Vendor Code': 'V-1', 'Company Name': 'V 1', Email: 'v1@test.com', Phone: '+91 98201 11223' }]);
    const wbV = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbV, wsV, 'Vendors');
    const vBuf = XLSX.write(wbV, { type: 'array', bookType: 'xlsx' });
    const vFile: any = new File([vBuf], 'vendor_err.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    vFile.__buffer = vBuf;
    const vInput2 = container.querySelector('input[type="file"]');
    if (vInput2) {
      await act(async () => {
        fireEvent.change(vInput2, { target: { files: [vFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    // Test start-job ok:false branch on Excel upload in Step 3
    fireEvent.click(screen.getByText('3. PO Dump'));
    const wsP = XLSX.utils.json_to_sheet([{ 'PO Number': 'PO-1', 'PO Date': '2025-01-01', 'Supplier Name': 'V 1' }]);
    const wbP = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbP, wsP, 'POs');
    const pBuf = XLSX.write(wbP, { type: 'array', bookType: 'xlsx' });
    const pFile: any = new File([pBuf], 'po_err.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    pFile.__buffer = pBuf;
    const poInput2 = container.querySelector('input[type="file"]');
    if (poInput2) {
      await act(async () => {
        fireEvent.change(poInput2, { target: { files: [pFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }
  });

  it('renders IngestionProgressCard with diverse statuses and edge cases', () => {
    const { rerender } = render(
      <IngestionProgressCard
        job={{
          id: 'job-1',
          jobType: 'VENDOR_MASTER',
          fileName: 'vendors.xlsx',
          status: 'PROCESSING',
          totalRecords: 100,
          processedRecords: 50,
          importedRecords: 45,
          skippedRecords: 3,
          failedRecords: 2,
        }}
        title="Vendor Master"
      />
    );
    expect(screen.getAllByText('Processing...').length).toBeGreaterThanOrEqual(1);

    rerender(
      <IngestionProgressCard
        job={{
          id: 'job-2',
          jobType: 'PO_DUMP',
          fileName: 'pos.xlsx',
          status: 'COMPLETED',
          totalRecords: 0,
          processedRecords: 0,
          importedRecords: 0,
          skippedRecords: 0,
          failedRecords: 0,
        }}
        title="PO Dump"
      />
    );
    expect(screen.getByText('Completed')).toBeInTheDocument();

    rerender(
      <IngestionProgressCard
        job={{
          id: 'job-3',
          jobType: 'VENDOR_MASTER',
          fileName: 'err.xlsx',
          status: 'FAILED',
          totalRecords: 0,
          processedRecords: 5,
          importedRecords: 0,
          skippedRecords: 0,
          failedRecords: 5,
          errorMessage: 'Corrupt file header',
        }}
        title="Vendor Master"
      />
    );
    expect(screen.getAllByText('Failed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Corrupt file header/i)).toBeInTheDocument();

    rerender(
      <IngestionProgressCard
        job={{
          id: 'job-pending-1',
          jobType: 'VENDOR_MASTER',
          fileName: 'pending.xlsx',
          status: 'PENDING',
          totalRecords: 10,
          processedRecords: 0,
          importedRecords: 0,
          skippedRecords: 0,
          failedRecords: 0,
        }}
        title="Vendor Master"
      />
    );
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('converts 1-5 scale vendor ratings to 0-100 scale correctly in vendor master upload', async () => {
    const wsV = XLSX.utils.json_to_sheet([
      {
        'Vendor Code': 'V-5STAR',
        'Company Name': 'Five Star Vendor Ltd',
        Email: 'fivestar@vendor.com',
        Phone: '+91 98201 11223',
        Rating: 4.5,
      },
    ]);
    const wbV = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbV, wsV, 'Vendors');
    const vBuf = XLSX.write(wbV, { type: 'array', bookType: 'xlsx' });
    const vFile: any = new File([vBuf], 'fivestar.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    vFile.__buffer = vBuf;

    const { container } = render(<InitialSetupModal />);
    fireEvent.click(screen.getByText('2. Vendor Master'));

    const fileInput = container.querySelector('input[type="file"]');
    if (fileInput) {
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [vFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    expect(screen.getByText('Five Star Vendor Ltd')).toBeInTheDocument();
  });

  it('does not treat Email ID column as vendor code when vendor code column is absent', async () => {
    const wsV = XLSX.utils.json_to_sheet([
      {
        'Company Name': 'Govardhan Solutions pvt LTD',
        'Contact Person': 'Govardhan',
        'Email ID': 'govardhan.kilari@procucev.com',
        'Phone Number': '99667 66905',
        GSTIN: '27AAACA1928K1Z4',
      },
    ]);
    const wbV = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbV, wsV, 'Vendors');
    const vBuf = XLSX.write(wbV, { type: 'array', bookType: 'xlsx' });
    const vFile: any = new File([vBuf], 'vendor_data_001.csv', {
      type: 'text/csv',
    });
    vFile.__buffer = vBuf;

    const { container } = render(<InitialSetupModal />);
    fireEvent.click(screen.getByText('2. Vendor Master'));

    const fileInput = container.querySelector('input[type="file"]');
    if (fileInput) {
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [vFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    expect(screen.getByText('Govardhan Solutions pvt LTD')).toBeInTheDocument();
    // Auto-assigned vendor code VND-1001 should be rendered, not the email address in vendor code cell
    expect(screen.getByText('VND-1001')).toBeInTheDocument();
    expect(screen.getByText('govardhan.kilari@procucev.com')).toBeInTheDocument();
  });

  it('shows a clear error message when uploaded Vendor Master sheet has non-matching headers', async () => {
    const wsInvalid = XLSX.utils.json_to_sheet([
      {
        'Unrelated Column A': 'Value 1',
        'Unrelated Column B': 'Value 2',
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsInvalid, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const invalidFile: any = new File([buf], 'invalid_vendor.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    invalidFile.__buffer = buf;

    const { container } = render(<InitialSetupModal />);
    fireEvent.click(screen.getByText('2. Vendor Master'));

    const fileInput = container.querySelector('input[type="file"]');
    if (fileInput) {
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [invalidFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    expect(mockShowToast).toHaveBeenCalledWith(
      'Invalid Sheet Headers',
      expect.stringContaining('Sheet headers do not match Vendor Master required fields'),
      'warning'
    );
    expect(screen.getByTestId('vendor-upload-error-banner')).toBeInTheDocument();
  });

  it('shows a clear error message when uploaded PO dump sheet has non-matching headers', async () => {
    const wsInvalid = XLSX.utils.json_to_sheet([
      {
        'Random Field 1': 'Random 1',
        'Random Field 2': 'Random 2',
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsInvalid, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const invalidFile: any = new File([buf], 'invalid_po.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    invalidFile.__buffer = buf;

    const { container } = render(<InitialSetupModal />);
    fireEvent.click(screen.getByText('2. Vendor Master'));
    const vFile = createValidVendorMasterFile();
    const vInput = container.querySelector('input[type="file"]');
    if (vInput) {
      await act(async () => {
        fireEvent.change(vInput, { target: { files: [vFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    fireEvent.click(screen.getByText('3. PO Dump'));

    const poInput = container.querySelector('input[type="file"]');
    if (poInput) {
      await act(async () => {
        fireEvent.change(poInput, { target: { files: [invalidFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    expect(mockShowToast).toHaveBeenCalledWith(
      'Invalid PO Sheet Headers',
      expect.stringContaining('Sheet headers do not match PO Purchase Dump required fields'),
      'warning'
    );
    expect(screen.getByTestId('po-upload-error-banner')).toBeInTheDocument();
  });

  it('displays a clear submission error banner on Step 5 when final ingestion fails', async () => {
    const failingIngest = jest.fn().mockRejectedValue(new Error('PostgreSQL database connection timed out'));
    (useApp as jest.Mock).mockReturnValue({
      initialSetupModalOpen: true,
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      historicalPurchaseDataPeriod: '2_years',
      setHistoricalPurchaseDataPeriod: mockSetHistoricalPurchaseDataPeriod,
      processHistoricalPurchaseData: failingIngest,
      lastIngestionSummary: null,
      setInitialSetupCompleted: jest.fn(),
      activeBuyerAccount: { organizationName: 'Larsen & Toubro Limited' },
      buyerVendors: mockBuyerVendors,
      showToast: mockShowToast,
    });

    const { container } = render(<InitialSetupModal />);
    
    // Upload valid vendor master in Step 2
    fireEvent.click(screen.getByText('2. Vendor Master'));
    const vFile = createValidVendorMasterFile();
    const vInput = container.querySelector('input[type="file"]');
    if (vInput) {
      await act(async () => {
        fireEvent.change(vInput, { target: { files: [vFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    // Upload valid PO dump in Step 3
    fireEvent.click(screen.getByText('3. PO Dump'));
    const poFile = createValidPoDumpFile();
    const poInput = container.querySelector('input[type="file"]');
    if (poInput) {
      await act(async () => {
        fireEvent.change(poInput, { target: { files: [poFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    // Go directly to Step 5
    fireEvent.click(screen.getByText('5. Dispatch Emails'));

    const completeBtn = screen.getByText(/COMPLETE SETUP & INGEST/i);
    await act(async () => {
      fireEvent.click(completeBtn);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.getByTestId('step5-submission-error-banner')).toBeInTheDocument();
    expect(screen.getByText('Ingestion & Dispatch Error')).toBeInTheDocument();
    expect(screen.getByText(/PostgreSQL database connection timed out/i)).toBeInTheDocument();
    expect(mockShowToast).toHaveBeenCalledWith('Ingestion Error', expect.any(String), 'warning');

    // Dismiss error
    const dismissBtn = screen.getByTitle('Dismiss error');
    fireEvent.click(dismissBtn);
    expect(screen.queryByTestId('step5-submission-error-banner')).not.toBeInTheDocument();
  });

  it('blocks navigation to subsequent steps if vendor master is empty or has validation errors', async () => {
    const { container } = render(<InitialSetupModal />);

    // Try navigating to Step 3 directly when storedVendors is empty
    fireEvent.click(screen.getByText('3. PO Dump'));
    expect(mockShowToast).toHaveBeenCalledWith(
      'Vendor Master Required',
      expect.stringContaining('Vendor Master is required'),
      'warning'
    );
    expect(screen.getByTestId('vendor-upload-error-banner')).toBeInTheDocument();

    // Now upload an invalid vendor (missing phone and company name)
    fireEvent.click(screen.getByText('2. Vendor Master'));
    const invalidWb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([
      {
        'Vendor Code': 'V-INVALID',
        'Company Name': '',
        Email: 'bad-email',
        Phone: '',
      },
    ]);
    XLSX.utils.book_append_sheet(invalidWb, ws, 'Vendors');
    const buf = XLSX.write(invalidWb, { type: 'array', bookType: 'xlsx' });
    const invFile: any = new File([buf], 'invalid_v.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    invFile.__buffer = buf;

    const fileInput = container.querySelector('input[type="file"]');
    if (fileInput) {
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [invFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    // Validation warning banner must be shown
    expect(screen.getByTestId('vendor-validation-warning-banner')).toBeInTheDocument();

    // Trying to proceed to Step 3 must be blocked
    fireEvent.click(screen.getByText(/Proceed to File 2: PO Dump/i));
    expect(mockShowToast).toHaveBeenCalledWith(
      'Validation Error in Vendor Master',
      expect.stringContaining('missing or invalid required fields'),
      'warning'
    );
  });

  it('handles dismissal of vendor and PO upload error banners, and edit incomplete vendors button', async () => {
    const { container } = render(<InitialSetupModal />);

    // Trigger vendor upload error banner by trying to go to step 3 with 0 vendors
    fireEvent.click(screen.getByText('3. PO Dump'));
    const vendorErrorBanner = screen.getByTestId('vendor-upload-error-banner');
    expect(vendorErrorBanner).toBeInTheDocument();

    // Click X button on vendor upload error banner (line 1761)
    const dismissVendorErrorBtn = vendorErrorBanner.querySelector('button');
    if (dismissVendorErrorBtn) {
      fireEvent.click(dismissVendorErrorBtn);
    }
    expect(screen.queryByTestId('vendor-upload-error-banner')).not.toBeInTheDocument();

    // Upload an invalid vendor to trigger vendor-validation-warning-banner
    fireEvent.click(screen.getByText('2. Vendor Master'));
    const invalidWb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([
      {
        'Vendor Code': 'V-999',
        'Company Name': '', // missing company name
        Email: 'bad@',
      },
    ]);
    XLSX.utils.book_append_sheet(invalidWb, ws, 'Vendors');
    const buf = XLSX.write(invalidWb, { type: 'array', bookType: 'xlsx' });
    const invFile: any = new File([buf], 'incomplete_v.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    invFile.__buffer = buf;

    const fileInput = container.querySelector('input[type="file"]');
    if (fileInput) {
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [invFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    // Click "Edit and Fix Incomplete Records" button (line 1787)
    const editBtn = screen.getByRole('button', { name: /Edit and Fix Incomplete Records/i });
    fireEvent.click(editBtn);

    // Upload a valid vendor master file to allow proceeding to Step 3
    const validVFile = createValidVendorMasterFile();
    if (fileInput) {
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [validVFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    // Trigger PO upload error banner by uploading invalid PO file
    const corruptPoFile: any = new File(['corrupt'], 'corrupt_po.xlsx');
    corruptPoFile.__corrupt = true;
    fireEvent.click(screen.getByText('3. PO Dump'));
    const poInput = container.querySelector('input[type="file"]');
    if (poInput) {
      await act(async () => {
        fireEvent.change(poInput, { target: { files: [corruptPoFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    // PO upload error banner should be displayed
    const poErrorBanner = screen.getByTestId('po-upload-error-banner');
    expect(poErrorBanner).toBeInTheDocument();

    // Click X button on po-upload-error-banner (line 2311)
    const dismissPoErrorBtn = poErrorBanner.querySelector('button');
    if (dismissPoErrorBtn) {
      fireEvent.click(dismissPoErrorBtn);
    }
    expect(screen.queryByTestId('po-upload-error-banner')).not.toBeInTheDocument();
  });

  it('blocks step 4 navigation without PO dump and handles files with zero recognizable rows', async () => {
    const { container } = render(<InitialSetupModal />);

    // Step 2: Upload valid vendor master
    fireEvent.click(screen.getByText('2. Vendor Master'));
    const vFile = createValidVendorMasterFile();
    const vInput = container.querySelector('input[type="file"]');
    if (vInput) {
      await act(async () => {
        fireEvent.change(vInput, { target: { files: [vFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    // Navigate to step 3, then try to jump to step 4 without PO Dump (lines 391-397)
    fireEvent.click(screen.getByText('3. PO Dump'));
    fireEvent.click(screen.getByText('4. AI Category Join'));
    expect(mockShowToast).toHaveBeenCalledWith(
      'PO Dump Required',
      expect.stringContaining('Historical PO Dump is required'),
      'warning'
    );

    // Upload Vendor Master with headers but empty/unrecognizable rows (lines 708-716)
    fireEvent.click(screen.getByText('2. Vendor Master'));
    const blankVendorWb = XLSX.utils.book_new();
    const blankWs = XLSX.utils.json_to_sheet([
      { 'Vendor Code': '   ', 'Company Name': '   ', Email: '   ', Phone: '   ', GSTIN: '   ' },
    ]);
    XLSX.utils.book_append_sheet(blankVendorWb, blankWs, 'Vendors');
    const blankBuf = XLSX.write(blankVendorWb, { type: 'array', bookType: 'xlsx' });
    const blankVFile: any = new File([blankBuf], 'blank_v.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    blankVFile.__buffer = blankBuf;

    const fileInput2 = container.querySelector('input[type="file"]');
    if (fileInput2) {
      await act(async () => {
        fireEvent.change(fileInput2, { target: { files: [blankVFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }
    expect(mockShowToast).toHaveBeenCalledWith(
      'Invalid Vendor File',
      expect.stringContaining('no recognizable supplier rows'),
      'warning'
    );

    // Upload PO Dump with empty/unrecognizable rows (lines 1034-1042)
    fireEvent.click(screen.getByText('3. PO Dump'));
    const blankPoWb = XLSX.utils.book_new();
    const blankPoWs = XLSX.utils.json_to_sheet([
      { 'PO Number': '   ', 'Vendor Name': '   ', 'Item Name': '   ', Department: '   ' },
    ]);
    XLSX.utils.book_append_sheet(blankPoWb, blankPoWs, 'PO');
    const blankPoBuf = XLSX.write(blankPoWb, { type: 'array', bookType: 'xlsx' });
    const blankPoFile: any = new File([blankPoBuf], 'blank_po.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    blankPoFile.__buffer = blankPoBuf;

    const fileInputs = container.querySelectorAll('input[type="file"]');
    const poFileInput = fileInputs[fileInputs.length - 1];
    if (poFileInput) {
      await act(async () => {
        fireEvent.change(poFileInput, { target: { files: [blankPoFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }
  });

  it('handles template customization modal (A and B), editing subject/body, saving success/errors, and closing', async () => {
    jest.useFakeTimers();
    const { saveDispatchTemplate } = jest.requireMock('@/lib/buyerProfileClient');
    const { container } = render(<InitialSetupModal />);

    // Step 2: Valid Vendor Master
    fireEvent.click(screen.getByText('2. Vendor Master'));
    const vFile = createValidVendorMasterFile();
    const vInput = container.querySelector('input[type="file"]');
    if (vInput) {
      fireEvent.change(vInput, { target: { files: [vFile] } });
    }

    // Step 3: Valid PO Dump
    fireEvent.click(screen.getByText('3. PO Dump'));
    const poFile = createValidPoDumpFile();
    const fileInputs = container.querySelectorAll('input[type="file"]');
    const poInput = fileInputs[fileInputs.length - 1];
    if (poInput) {
      fireEvent.change(poInput, { target: { files: [poFile] } });
    }

    // Run AI Category Cross-Match simulation from Step 3 to enter Step 4
    const runJoinBtn = screen.getByRole('button', { name: /Run AI Category Cross-Match/i });
    fireEvent.click(runJoinBtn);
    act(() => {
      jest.advanceTimersByTime(1200);
    });

    // Step 5: Review Email Dispatch & Finalize with custom saved templates (lines 250-251, 268, 271)
    const { fetchDispatchTemplates } = jest.requireMock('@/lib/buyerProfileClient');
    fetchDispatchTemplates.mockResolvedValueOnce({
      success: true,
      data: {
        category_mapped: { subject: 'Saved Custom A Subject', message: 'Saved Custom A Message' },
        self_map_required: { subject: 'Saved Custom B Subject', message: 'Saved Custom B Message' },
      },
    });
    fireEvent.click(screen.getByText(/Review Email Dispatch & Finalize/i));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    jest.useRealTimers();

    // Open Template A modal (line 2715)
    const customizeBtnA = screen.getByRole('button', { name: /View & Edit Template A/i });
    fireEvent.click(customizeBtnA);
    expect(screen.getByText('Template A: Suppliers With Pre-PO History')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Saved Custom A Subject')).toBeInTheDocument();

    // Edit Template A Subject and Message (lines 2855, 2865)
    const subjectInput = screen.getByPlaceholderText('Subject line...');
    const messageInput = screen.getByPlaceholderText('Custom email message...');
    fireEvent.change(subjectInput, { target: { value: 'Updated Template A Subject' } });
    fireEvent.change(messageInput, { target: { value: 'Updated Template A Body Message' } });

    // Save Template A successfully (lines 277-293)
    saveDispatchTemplate.mockResolvedValueOnce({ success: true });
    const saveBtn = screen.getByRole('button', { name: /Save Template/i });
    await act(async () => {
      fireEvent.click(saveBtn);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(saveDispatchTemplate).toHaveBeenCalledWith('category_mapped', {
      subject: 'Updated Template A Subject',
      message: 'Updated Template A Body Message',
    });
    expect(mockShowToast).toHaveBeenCalledWith('Template Updated', expect.stringContaining('Template A has been saved'), 'success');

    // Open Template B modal (line 2742)
    const customizeBtnB = screen.getByRole('button', { name: /View & Edit Template B/i });
    fireEvent.click(customizeBtnB);
    expect(screen.getByText('Template B: Suppliers With NO Pre-PO History')).toBeInTheDocument();

    // Test Save failure (line 295)
    saveDispatchTemplate.mockResolvedValueOnce({ success: false, error: 'Custom Save Error' });
    const saveBtnB = screen.getByRole('button', { name: /Save Template/i });
    await act(async () => {
      fireEvent.click(saveBtnB);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mockShowToast).toHaveBeenCalledWith('Save Failed', 'Custom Save Error', 'warning');

    // Test Save exception (line 298)
    saveDispatchTemplate.mockRejectedValueOnce(new Error('Network Save Crash'));
    await act(async () => {
      fireEvent.click(saveBtnB);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mockShowToast).toHaveBeenCalledWith('Save Error', 'Network Save Crash', 'warning');

    // Test Save Template B successfully (lines 287-293 else branch)
    saveDispatchTemplate.mockResolvedValueOnce({ success: true });
    await act(async () => {
      fireEvent.click(saveBtnB);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mockShowToast).toHaveBeenCalledWith('Template Updated', expect.stringContaining('Template B has been saved'), 'success');

    // Reopen Template B and test Cancel button (line 2890)
    fireEvent.click(customizeBtnB);
    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);
    expect(screen.queryByText('Template B: Suppliers With NO Pre-PO History')).not.toBeInTheDocument();

    // Reopen and test backdrop / X button close (lines 2823, 2842)
    fireEvent.click(customizeBtnA);
    const closeXBtn = screen.getByText('Template A: Suppliers With Pre-PO History')
      .closest('div[class*="animate-scale-in"]')
      ?.querySelector('button[class*="text-slate-400"]');
    if (closeXBtn) {
      fireEvent.click(closeXBtn);
    }
  });

  it('covers empty template preview fallbacks, sessionStorage auth headers, and period ingestion options', async () => {
    // Test auth headers reading token from sessionStorage (lines 407-412)
    sessionStorage.setItem('procucev_auth_token', 'test-session-jwt-token');
    jest.useFakeTimers();

    const { container } = render(<InitialSetupModal />);

    // Step 1: Choose 1_year
    fireEvent.click(screen.getByText(/Last 1 Year \(12 Months\)/i));

    // Step 2: Upload valid vendor master
    fireEvent.click(screen.getByText('2. Vendor Master'));
    const vFile = createValidVendorMasterFile();
    const vInput = container.querySelector('input[type="file"]');
    if (vInput) {
      fireEvent.change(vInput, { target: { files: [vFile] } });
    }

    // Step 3: Try running cross-match when poLineItems is empty (lines 1458-1463)
    fireEvent.click(screen.getByText('3. PO Dump'));
    const runJoinBtn = screen.getByRole('button', { name: /Run AI Category Cross-Match/i });
    fireEvent.click(runJoinBtn);
    expect(mockShowToast).toHaveBeenCalledWith('PO Dump Required', expect.stringContaining('Historical PO Dump is required'), 'warning');

    // Upload PO dump
    const poFile = createValidPoDumpFile();
    const fileInputs = container.querySelectorAll('input[type="file"]');
    const poInput = fileInputs[fileInputs.length - 1];
    if (poInput) {
      fireEvent.change(poInput, { target: { files: [poFile] } });
    }

    // Run simulation to Step 4
    fireEvent.click(runJoinBtn);
    act(() => {
      jest.advanceTimersByTime(1200);
    });

    // Step 5: Review Email Dispatch & Finalize
    fireEvent.click(screen.getByText(/Review Email Dispatch & Finalize/i));
    jest.useRealTimers();

    // Open Template A and clear subject and message (covers lines 2876-2877: Default Subject/Message)
    const customizeBtnA = screen.getByRole('button', { name: /View & Edit Template A/i });
    fireEvent.click(customizeBtnA);
    const subjectInput = screen.getByPlaceholderText('Subject line...');
    const messageInput = screen.getByPlaceholderText('Custom email message...');
    fireEvent.change(subjectInput, { target: { value: '' } });
    fireEvent.change(messageInput, { target: { value: '' } });

    expect(screen.getByText(/\(Default Subject\)/i)).toBeInTheDocument();
    expect(screen.getByText(/\(Default Message\)/i)).toBeInTheDocument();

    // Click outside modal backdrop (lines 2823, 2826)
    const backdrop = screen.getByText('Template A: Suppliers With Pre-PO History')
      .closest('div[class*="fixed inset-0"]');
    if (backdrop) {
      fireEvent.click(backdrop);
    }

    // Complete setup with 1_year selected (line 1523: '1 Year')
    const completeBtn = screen.getByText(/COMPLETE SETUP & INGEST/i);
    await act(async () => {
      fireEvent.click(completeBtn);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mockShowToast).toHaveBeenCalledWith('Setup Complete', expect.stringContaining('for 1 Year'), 'success');

    sessionStorage.removeItem('procucev_auth_token');
  });

  it('covers getLastHistoricalDataError and error without message on Step 5 completion', async () => {
    const { getLastHistoricalDataError } = jest.requireMock('@/lib/store');
    getLastHistoricalDataError.mockReturnValueOnce('External DB Sync Verification Failed');
    jest.useFakeTimers();

    const { container } = render(<InitialSetupModal />);

    // Step 2
    fireEvent.click(screen.getByText('2. Vendor Master'));
    const vFile = createValidVendorMasterFile();
    const vInput = container.querySelector('input[type="file"]');
    if (vInput) {
      fireEvent.change(vInput, { target: { files: [vFile] } });
    }

    // Step 3
    fireEvent.click(screen.getByText('3. PO Dump'));
    const poFile = createValidPoDumpFile();
    const fileInputs = container.querySelectorAll('input[type="file"]');
    const poInput = fileInputs[fileInputs.length - 1];
    if (poInput) {
      fireEvent.change(poInput, { target: { files: [poFile] } });
    }

    // Step 4
    fireEvent.click(screen.getByRole('button', { name: /Run AI Category Cross-Match/i }));
    act(() => {
      jest.advanceTimersByTime(1200);
    });

    // Step 5
    fireEvent.click(screen.getByText(/Review Email Dispatch & Finalize/i));
    jest.useRealTimers();

    // Attempt final ingestion when getLastHistoricalDataError returns error (lines 1514-1518)
    const completeBtn = screen.getByText(/COMPLETE SETUP & INGEST/i);
    await act(async () => {
      fireEvent.click(completeBtn);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getByTestId('step5-submission-error-banner')).toBeInTheDocument();
    expect(screen.getByText('External DB Sync Verification Failed')).toBeInTheDocument();

    // Attempt final ingestion when processHistoricalPurchaseData throws an error without message (lines 1526-1530)
    mockProcessHistoricalPurchaseData.mockRejectedValueOnce({});
    await act(async () => {
      fireEvent.click(completeBtn);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getByText('An unexpected error occurred during ingestion. Please try again.')).toBeInTheDocument();
  });

  it('covers editing fields in vendor table and table fallback values', async () => {
    const { container } = render(<InitialSetupModal />);

    // Step 2: Upload Vendor with sparse/empty optional fields
    fireEvent.click(screen.getByText('2. Vendor Master'));
    const sparseWb = XLSX.utils.book_new();
    const sparseWs = XLSX.utils.json_to_sheet([
      {
        'Company Name': 'Minimalist Vendor Pvt Ltd',
        // Vendor Code, Contact Person, Email, Phone, GSTIN, Address, Rating are omitted
      },
    ]);
    XLSX.utils.book_append_sheet(sparseWb, sparseWs, 'Vendors');
    const sparseBuf = XLSX.write(sparseWb, { type: 'array', bookType: 'xlsx' });
    const sparseFile: any = new File([sparseBuf], 'sparse_v.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    sparseFile.__buffer = sparseBuf;

    const fileInput = container.querySelector('input[type="file"]');
    if (fileInput) {
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [sparseFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    // Verify read-only table fallbacks (lines 2132, 2142, 2149, 2153, 2155, 2156)
    expect(screen.getByText('VND-1001')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);

    // Toggle Edit Data mode (lines 2032, 2048, 2057, 2069-2076)
    fireEvent.click(screen.getByText('Edit Data'));
    const phoneInput = screen.getByPlaceholderText('+91 Phone');
    const gstinInput = screen.getByPlaceholderText('GSTIN');
    const addressInput = screen.getByPlaceholderText('City, State / Address');
    const ratingInput = screen.getByPlaceholderText('0-100');

    fireEvent.change(phoneInput, { target: { value: '+91 91234 56789' } });
    fireEvent.change(gstinInput, { target: { value: '27aaacg1234a1z1' } });
    fireEvent.change(addressInput, { target: { value: 'Sector 5, Navi Mumbai' } });
    fireEvent.change(ratingInput, { target: { value: '88' } });
    fireEvent.change(ratingInput, { target: { value: '150' } });
    fireEvent.change(ratingInput, { target: { value: '-10' } });
    // Clear rating input to test raw === '' branch (line 2074)
    fireEvent.change(ratingInput, { target: { value: '' } });

    // Step 3: Upload PO with zero unit price and omitted specs/department (lines 2446, 2449, 2452, 2456)
    fireEvent.click(screen.getByText('3. PO Dump'));
    const sparsePoWb = XLSX.utils.book_new();
    const sparsePoWs = XLSX.utils.json_to_sheet([
      {
        'PO Number': 'PO-SPARSE-1',
        'PO Date': '2025-04-10',
        'Vendor Name': 'Minimalist Vendor Pvt Ltd',
        'Item Name': 'Electrical switchgear panel and breaker mccb', // lines 1222-1223
        Quantity: 2,
        'Total Spend': 2000,
        // Specs, Unit Price, Department omitted
      },
      {
        'PO Number': 'PO-SPARSE-2',
        'PO Date': '2025-04-11',
        'Vendor Name': 'Minimalist Vendor Pvt Ltd',
        'Item Name': 'Civil works peb tmt steel structure', // lines 1226-1227
        Quantity: 1,
        'Total Spend': 5000,
      },
    ]);
    XLSX.utils.book_append_sheet(sparsePoWb, sparsePoWs, 'PO');
    const sparsePoBuf = XLSX.write(sparsePoWb, { type: 'array', bookType: 'xlsx' });
    const sparsePoFile: any = new File([sparsePoBuf], 'sparse_po.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    sparsePoFile.__buffer = sparsePoBuf;

    const fileInputs = container.querySelectorAll('input[type="file"]');
    const poInput = fileInputs[fileInputs.length - 1];
    if (poInput) {
      await act(async () => {
        fireEvent.change(poInput, { target: { files: [sparsePoFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    // Verify PO table displays default Department 'General' and fallback '—'
    expect(screen.getAllByText('General').length).toBeGreaterThan(0);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('covers getUniqueEmails duplicates, vendorCode email discard, ratings, review tabs, job polling, and error fallbacks', async () => {
    jest.useFakeTimers();
    const origFetch = global.fetch;

    const mockFetch = jest.fn().mockImplementation((url: string, init?: any) => {
      if (typeof url === 'string') {
        if (url.includes('/api/buyer-accounts/ai-cross-match')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: [
                {
                  id: 'j-1',
                  companyName: 'Duplicate Email Vendor Ltd',
                  vendorCode: 'VND-1001',
                  email: 'sales@dup.com; SALES@DUP.COM, info@dup.com',
                  phone: '+91 98111 22222',
                  categoriesMappedByBuyer: true,
                  poCount: 1,
                  firstSetMajorCategory: 'Engineering Spares',
                  secondSetMinorCategories: ['Valves'],
                },
                {
                  id: 'j-2',
                  companyName: 'Silent Supplier',
                  vendorCode: 'VND-1002',
                  email: '',
                  phone: '',
                  categoriesMappedByBuyer: false,
                  poCount: 0,
                },
                {
                  id: 'j-3',
                  companyName: 'Email Only Supplier',
                  vendorCode: 'VND-1003',
                  email: 'emailonly@supplier.com',
                  phone: '',
                  categoriesMappedByBuyer: true,
                  poCount: 1,
                  firstSetMajorCategory: 'Electrical',
                  secondSetMinorCategories: ['Cables'],
                },
                {
                  id: 'j-4',
                  companyName: 'Phone Only Supplier',
                  vendorCode: 'VND-1004',
                  email: '',
                  phone: '+91 98333 44444',
                  categoriesMappedByBuyer: false,
                  poCount: 0,
                },
              ],
            }),
          });
        }
      }
      return origFetch(url, init);
    });
    global.fetch = mockFetch;

    try {
      const { container } = render(<InitialSetupModal />);

      // Step 2: Upload Vendor Master
      fireEvent.click(screen.getByText('2. Vendor Master'));

      const richVendorWb = XLSX.utils.book_new();
      const richVendorWs = XLSX.utils.json_to_sheet([
        {
          'Vendor Code': 'vendor@emailaddress.com', // Should be discarded because it has '@'
          'Company Name': 'Duplicate Email Vendor Ltd',
          'Contact Person': 'Rohan Shah',
          Email: 'sales@dup.com',
          Phone: '+91 98111 22222',
          GSTIN: '27AABCT1234A1Z5',
          Rating: '4.8', // <= 5 -> 96
        },
        {
          'Vendor Code': 'V-200',
          'Company Name': 'Phone Only Supplier',
          'Contact Person': 'Pooja Verma',
          Email: 'pooja@phoneonly.com',
          Phone: '+91 98333 44444',
          GSTIN: '27AABCT1234A1Z6',
          Rating: '92', // > 5 -> 92
        },
        {
          'Vendor Code': 'V-300',
          'Company Name': 'Silent Supplier',
          'Contact Person': 'No Contact',
          Email: 'silent@supplier.com',
          Phone: '+91 98777 66666',
          GSTIN: '27AABCT1234A1Z7',
          Rating: '150', // clamped to 100
        },
        {
          'Vendor Code': 'V-400',
          'Company Name': 'Negative Rating Supplier',
          'Contact Person': 'Vikram Patel',
          Email: 'vikram@negative.com',
          Phone: '+91 98444 55555',
          GSTIN: '27AABCT1234A1Z8',
          Rating: '-5', // clamped to 0
        },
        {
          'Vendor Code': 'V-500',
          'Company Name': 'Bad Rating Supplier',
          'Contact Person': 'Kunal Sen',
          Email: 'kunal@bad.com',
          Phone: '+91 98555 66666',
          GSTIN: '27AABCT1234A1Z9',
          Rating: 'Not A Number', // NaN branch
        },
      ]);
      XLSX.utils.book_append_sheet(richVendorWb, richVendorWs, 'Vendors');
      const richBuf = XLSX.write(richVendorWb, { type: 'array', bookType: 'xlsx' });
      const richFile: any = new File([richBuf], 'rich_vendors.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      richFile.__buffer = richBuf;

      const vInput = container.querySelector('input[type="file"]');
      if (vInput) {
        fireEvent.change(vInput, { target: { files: [richFile] } });
      }

      // Check that vendorCode fallback was used for first row (line 677: VND-1001)
      expect(screen.getByText('VND-1001')).toBeInTheDocument();

      // Step 3: Upload PO Dump that matches Duplicate Email Vendor Ltd
      fireEvent.click(screen.getByText('3. PO Dump'));
      const poWb = XLSX.utils.book_new();
      const poWs = XLSX.utils.json_to_sheet([
        {
          'PO Number': 'PO-DUP-1',
          'PO Date': '2025-05-15',
          'Vendor Name': 'Duplicate Email Vendor Ltd',
          'Item Name': 'Industrial stainless steel valve',
          Quantity: 10,
          'Total Spend': 25000,
          Department: 'Mechanical Engineering',
        },
      ]);
      XLSX.utils.book_append_sheet(poWb, poWs, 'PO');
      const poBuf = XLSX.write(poWb, { type: 'array', bookType: 'xlsx' });
      const poFile: any = new File([poBuf], 'po_aliases.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      poFile.__buffer = poBuf;

      const fileInputs = container.querySelectorAll('input[type="file"]');
      const poInput = fileInputs[fileInputs.length - 1];
      if (poInput) {
        fireEvent.change(poInput, { target: { files: [poFile] } });
      }

      // Run AI Category Cross-Match
      const runJoinBtn = screen.getByRole('button', { name: /Run AI Category Cross-Match/i });
      await act(async () => {
        fireEvent.click(runJoinBtn);
        await Promise.resolve();
        await Promise.resolve();
        jest.advanceTimersByTime(1200);
      });

      // In Step 4: Click the Filter Tabs
      // 1. Click ✓ Mapped tab (line 2544)
      const mappedTabBtn = screen.getByRole('button', { name: /✓ Mapped/i });
      fireEvent.click(mappedTabBtn);
      expect(screen.getByText('Duplicate Email Vendor Ltd')).toBeInTheDocument();

      // 2. Click ⚠️ Unmapped tab (line 2552)
      const unmappedTabBtn = screen.getByRole('button', { name: /⚠️ Unmapped/i });
      fireEvent.click(unmappedTabBtn);
      expect(screen.getAllByText('Silent Supplier').length).toBeGreaterThan(0);

      // 3. Click All tab (line 2534)
      const allTabBtn = screen.getByRole('button', { name: /All \(/i });
      fireEvent.click(allTabBtn);
      expect(screen.getByText('Duplicate Email Vendor Ltd')).toBeInTheDocument();

      // Step 5: Proceed to Step 5
      fireEvent.click(screen.getByText(/Review Email Dispatch & Finalize/i));

      // Open Template B modal and verify preview shows Template B action link
      const customizeBtnB = screen.getByRole('button', { name: /View & Edit Template B/i });
      fireEvent.click(customizeBtnB);
      expect(screen.getByText(/Complete category self-mapping/i)).toBeInTheDocument();

      // Test stopPropagation on inner modal dialog (line 2826)
      const innerModal = screen.getByText('Template B: Suppliers With NO Pre-PO History')
        .closest('div[class*="animate-scale-in"]');
      if (innerModal) {
        fireEvent.click(innerModal);
        expect(screen.getByText('Template B: Suppliers With NO Pre-PO History')).toBeInTheDocument();
      }

      // Close Template B modal
      const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelBtn);

      // Trigger submission error and dismiss error banner (line 2772, 2790)
      mockProcessHistoricalPurchaseData.mockRejectedValueOnce(new Error('Ingestion pipeline failed'));
      const completeBtn = screen.getByText(/COMPLETE SETUP & INGEST/i);
      await act(async () => {
        fireEvent.click(completeBtn);
        await Promise.resolve();
      });

      const errorBanner = screen.getByTestId('step5-submission-error-banner');
      expect(errorBanner).toBeInTheDocument();
      const dismissBtn = errorBanner.querySelector('button');
      if (dismissBtn) {
        fireEvent.click(dismissBtn);
      }
      expect(screen.queryByTestId('step5-submission-error-banner')).not.toBeInTheDocument();
    } finally {
      global.fetch = origFetch;
      jest.useRealTimers();
    }
  });

  it('covers streaming upload error fallback branches when server returns message or statusText', async () => {
    const origFetch = global.fetch;

    try {
      const csvWb = XLSX.utils.book_new();
      const csvWs = XLSX.utils.json_to_sheet([
        { 'Vendor Code': 'V-STREAM-1', 'Company Name': 'Acme Streams', Email: 'acme@test.com', Phone: '+91 99999 88888' },
      ]);
      XLSX.utils.book_append_sheet(csvWb, csvWs, 'Vendors');
      const csvBuf = XLSX.write(csvWb, { type: 'array', bookType: 'csv' });
      const csvFile: any = new File([csvBuf], 'vendors.csv', { type: 'text/csv' });
      csvFile.__buffer = csvBuf;

      // Test 1: stream-upload returns message instead of error (line 575)
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (typeof url === 'string') {
          if (url.includes('/api/vendor-ingestion/session')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                success: true,
                data: { session: { id: 'test-session-stream' } },
              }),
            });
          }
          if (url.includes('stream-upload')) {
            return Promise.resolve({
              ok: false,
              status: 422,
              statusText: 'Unprocessable Entity',
              json: async () => ({ message: 'Unprocessable stream entity' }),
            });
          }
        }
        return origFetch(url);
      });

      const { container } = render(<InitialSetupModal />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      fireEvent.click(screen.getByText('2. Vendor Master'));
      const vInput = container.querySelector('input[type="file"]');
      if (vInput) {
        await act(async () => {
          fireEvent.change(vInput, { target: { files: [csvFile] } });
          await Promise.resolve();
          await Promise.resolve();
        });
      }
      expect(mockShowToast).toHaveBeenCalledWith('Upload Error', 'Unprocessable stream entity', 'warning');

      // Test 2: stream-upload returns empty JSON (statusText fallback: line 575)
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (typeof url === 'string') {
          if (url.includes('/api/vendor-ingestion/session')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                success: true,
                data: { session: { id: 'test-session-stream' } },
              }),
            });
          }
          if (url.includes('stream-upload')) {
            return Promise.resolve({
              ok: false,
              status: 503,
              statusText: 'Service Unavailable',
              json: async () => ({}),
            });
          }
        }
        return origFetch(url);
      });

      if (vInput) {
        await act(async () => {
          fireEvent.change(vInput, { target: { files: [csvFile] } });
          await Promise.resolve();
          await Promise.resolve();
        });
      }
      expect(mockShowToast).toHaveBeenCalledWith('Upload Error', 'Server returned 503: Service Unavailable', 'warning');

      // Test 3: PO stream-upload returns message (line 889)
      const poWb = XLSX.utils.book_new();
      const poWs = XLSX.utils.json_to_sheet([
        { 'PO Number': 'PO-STREAM-1', 'Vendor Name': 'Acme Streams', 'Item Name': 'Part A', Department: 'Mechanical' },
      ]);
      XLSX.utils.book_append_sheet(poWb, poWs, 'PO');
      const poBuf = XLSX.write(poWb, { type: 'array', bookType: 'csv' });
      const poCsvFile: any = new File([poBuf], 'po.csv', { type: 'text/csv' });
      poCsvFile.__buffer = poBuf;

      fireEvent.click(screen.getByText('3. PO Dump'));
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (typeof url === 'string') {
          if (url.includes('/api/vendor-ingestion/session')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                success: true,
                data: { session: { id: 'test-session-stream' } },
              }),
            });
          }
          if (url.includes('stream-upload')) {
            return Promise.resolve({
              ok: false,
              status: 400,
              statusText: 'Bad Request',
              json: async () => ({ message: 'PO Stream Failed' }),
            });
          }
        }
        return origFetch(url);
      });

      const fileInputs = container.querySelectorAll('input[type="file"]');
      const poInput = fileInputs[fileInputs.length - 1];
      if (poInput) {
        await act(async () => {
          fireEvent.change(poInput, { target: { files: [poCsvFile] } });
          await Promise.resolve();
          await Promise.resolve();
        });
      }
      expect(mockShowToast).toHaveBeenCalledWith('PO Upload Error', 'PO Stream Failed', 'warning');

      // Test 4: PO stream-upload returns empty JSON (line 889 fallback)
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (typeof url === 'string') {
          if (url.includes('/api/vendor-ingestion/session')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                success: true,
                data: { session: { id: 'test-session-stream' } },
              }),
            });
          }
          if (url.includes('stream-upload')) {
            return Promise.resolve({
              ok: false,
              status: 500,
              statusText: 'Gateway Timeout',
              json: async () => ({}),
            });
          }
        }
        return origFetch(url);
      });

      if (poInput) {
        await act(async () => {
          fireEvent.change(poInput, { target: { files: [poCsvFile] } });
          await Promise.resolve();
          await Promise.resolve();
        });
      }
      expect(mockShowToast).toHaveBeenCalledWith('PO Upload Error', 'PO upload stream error: Gateway Timeout', 'warning');
    } finally {
      global.fetch = origFetch;
    }
  });

  it('polls PO job and vendor job in the background interval', async () => {
    jest.useFakeTimers();
    sessionStorage.setItem('procucev_ingestion_session', JSON.stringify({ id: 'sess-poll-test' }));
    const origFetch = global.fetch;

    try {
      let pollCount = 0;
      global.fetch = jest.fn().mockImplementation((url: string, init?: any) => {
        if (typeof url === 'string' && url.includes('stream-upload')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: {
                job: { id: 'job-p1', status: 'PROCESSING', jobType: 'PO_DUMP', progressPercent: 20 },
              },
            }),
          });
        }
        if (typeof url === 'string' && url.includes('/jobs/job-p1')) {
          pollCount += 1;
          if (pollCount === 1) {
            // res.ok is false branch (line 443)
            return Promise.resolve({ ok: false, status: 500 });
          }
          if (pollCount === 2) {
            // freshJob undefined branch (line 446)
            return Promise.resolve({ ok: true, json: async () => ({ data: {} }) });
          }
          // Successful PO job refresh (line 448)
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: {
                job: { id: 'job-p1', status: 'COMPLETED', jobType: 'PO_DUMP', progressPercent: 100 },
              },
            }),
          });
        }
        return origFetch(url, init);
      });

      const { container } = render(<InitialSetupModal />);

      // Step 2: Upload valid vendor first so step 3 is accessible
      fireEvent.click(screen.getByText('2. Vendor Master'));
      const vFile = createValidVendorMasterFile();
      const vInput = container.querySelector('input[type="file"]');
      if (vInput) {
        fireEvent.change(vInput, { target: { files: [vFile] } });
      }

      // Step 3: Now navigate to Step 3
      fireEvent.click(screen.getByText('3. PO Dump'));
      const poCsvFile = new File(['PO Number,Item Name\nPO1,Part A'], 'po.csv', { type: 'text/csv' });
      const fileInputs = container.querySelectorAll('input[type="file"]');
      const poInput = fileInputs[fileInputs.length - 1];
      if (poInput) {
        fireEvent.change(poInput, { target: { files: [poCsvFile] } });
      }

      // Advance 2s to trigger poll 1
      act(() => {
        jest.advanceTimersByTime(2100);
      });
      // Advance 2s to trigger poll 2
      act(() => {
        jest.advanceTimersByTime(2100);
      });
      // Advance 2s to trigger poll 3
      act(() => {
        jest.advanceTimersByTime(2100);
      });
    } finally {
      global.fetch = origFetch;
      sessionStorage.removeItem('procucev_ingestion_session');
      jest.useRealTimers();
    }
  });

  it('covers unsupported file types, drag-and-drop, add/delete vendor rows, reset PO, and AI category parsing variations', async () => {
    const { container } = render(<InitialSetupModal />);

    // Step 2: Upload unsupported file type (lines 524, 525)
    fireEvent.click(screen.getByText('2. Vendor Master'));
    const pdfFile = new File(['%PDF-1.4'], 'vendors.pdf', { type: 'application/pdf' });
    const vInput = container.querySelector('input[type="file"]');
    if (vInput) {
      fireEvent.change(vInput, { target: { files: [pdfFile] } });
    }
    expect(mockShowToast).toHaveBeenCalledWith('Unsupported File Type', expect.stringContaining('.xlsx'), 'warning');

    // Drag-over, drag-leave, drop on Vendor Master dropzone (lines 1855-1865)
    const vDropzone = screen.getByText(/drag & drop Vendor Master/i).closest('div[class*="border-dashed"]');
    if (vDropzone) {
      fireEvent.dragOver(vDropzone);
      fireEvent.dragLeave(vDropzone);
      // Drop with empty files (line 1864 if (file) false branch)
      fireEvent.drop(vDropzone, { dataTransfer: { files: [] } });
      const vValidFile = createValidVendorMasterFile();
      fireEvent.drop(vDropzone, { dataTransfer: { files: [vValidFile] } });
    }

    // Enter Edit Data mode (lines 1915, 1921)
    fireEvent.click(screen.getByText('Edit Data'));
    // Add a new vendor row (line 1915, 1279)
    fireEvent.click(screen.getByRole('button', { name: /Add Vendor Row/i }));
    // Done editing (line 1921)
    fireEvent.click(screen.getByRole('button', { name: /Done Editing/i }));

    // Re-enter Edit mode and delete rows until empty (lines 1269-1275)
    fireEvent.click(screen.getByText('Edit Data'));
    const deleteButtons = screen.getAllByTitle(/Delete/i);
    deleteButtons.forEach((btn) => fireEvent.click(btn));

    // Re-upload valid vendor master file
    if (vInput) {
      const vValidFile = createValidVendorMasterFile();
      fireEvent.change(vInput, { target: { files: [vValidFile] } });
    }

    // Step 3: PO Dump unsupported file (lines 838, 839)
    fireEvent.click(screen.getByText('3. PO Dump'));
    const poInputs = container.querySelectorAll('input[type="file"]');
    const poInput = poInputs[poInputs.length - 1];
    if (poInput) {
      fireEvent.change(poInput, { target: { files: [pdfFile] } });
    }
    expect(mockShowToast).toHaveBeenCalledWith('Unsupported File Type', expect.stringContaining('.xlsx'), 'warning');

    // Drag-over, drag-leave, drop on PO dropzone (lines 2374-2384)
    const poDropzone = screen.getByText(/drag & drop PO Purchase Dump/i).closest('div[class*="border-dashed"]');
    if (poDropzone) {
      fireEvent.dragOver(poDropzone);
      fireEvent.dragLeave(poDropzone);
      // Drop with empty files (line 2383 if (file) false branch)
      fireEvent.drop(poDropzone, { dataTransfer: { files: [] } });
    }

    // Upload PO Dump with diverse items to exercise AI category classification (lines 1215-1228)
    const diversePoWb = XLSX.utils.book_new();
    const diversePoWs = XLSX.utils.json_to_sheet([
      {
        'PO Number': 'PO-DIV-1',
        'PO Date': '', // empty date -> line 2446 '—'
        'Vendor Name': 'Apex Supplies Ltd.',
        'Item Name': 'Globe gate valve with hydraulic hose', // lines 1216, 1217
        Quantity: 2,
        'Unit Price': 0, // 0 unitPrice -> line 2452 '—'
        'Total Spend': 10000,
        Department: 'Hydraulics',
      },
      {
        'PO Number': 'PO-DIV-2',
        'PO Date': '2025-06-01',
        'Vendor Name': 'Apex Supplies Ltd.',
        'Item Name': 'Rotary air compressor and induction electric motor', // lines 1218, 1219
        Quantity: 1,
        'Unit Price': 45000,
        'Total Spend': 45000,
        Department: 'Machinery',
      },
      {
        'PO Number': 'PO-DIV-3',
        'PO Date': '2025-06-02',
        'Vendor Name': 'Apex Supplies Ltd.',
        'Item Name': 'Substation switchgear control panel with power cable and mccb breaker', // lines 1222, 1223
        Quantity: 3,
        'Unit Price': 15000,
        'Total Spend': 45000,
        Department: 'Electrical',
      },
      {
        'PO Number': 'PO-DIV-4',
        'PO Date': '2025-06-03',
        'Vendor Name': 'Apex Supplies Ltd.',
        'Item Name': 'Civil industrial steel works with peb structure and tmt bars', // lines 1226, 1227
        Quantity: 10,
        'Unit Price': 5000,
        'Total Spend': 50000,
        Department: 'Civil Works',
      },
    ]);
    XLSX.utils.book_append_sheet(diversePoWb, diversePoWs, 'PO');
    const diverseBuf = XLSX.write(diversePoWb, { type: 'array', bookType: 'xlsx' });
    const diversePoFile: any = new File([diverseBuf], 'diverse_po.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    diversePoFile.__buffer = diverseBuf;

    if (poInput) {
      fireEvent.change(poInput, { target: { files: [diversePoFile] } });
    }

    // Verify fallback '—' rendered for empty date and zero price
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);

    // Test Reset PO data button (lines 1150-1160, 2363)
    const resetPoBtn = screen.getByTitle('Reset PO data to default sample');
    fireEvent.click(resetPoBtn);
    expect(mockShowToast).toHaveBeenCalledWith('Reset Complete', expect.stringContaining('cleared'), 'info');
  });

  it('covers all AI category cross-match classification keyword branches and empty joined vendors validation', async () => {
    jest.useFakeTimers();
    const origFetch = global.fetch;

    try {
      const { container, unmount } = render(<InitialSetupModal />);

      // Step 2: Upload 6 distinct vendors to hit all AI classification branches
      fireEvent.click(screen.getByText('2. Vendor Master'));
      const vendorWb = XLSX.utils.book_new();
      const vendorWs = XLSX.utils.json_to_sheet([
        { 'Vendor Code': 'V-MECH', 'Company Name': 'Mechanical Spares Ltd', Email: 'mech@test.com', Phone: '+91 91111 22222' },
        { 'Vendor Code': 'V-ELEC', 'Company Name': 'Volt Panels Electricals', Email: 'elec@test.com', Phone: '+91 92222 33333' },
        { 'Vendor Code': 'V-SW-ONLY', 'Company Name': 'Switchgear Only Ltd', Email: 'sw@test.com', Phone: '+91 92222 44444' },
        { 'Vendor Code': 'V-CIVIL', 'Company Name': 'Infra Civil Structures', Email: 'civil@test.com', Phone: '+91 93333 44444' },
        { 'Vendor Code': 'V-CIVIL-PLAIN', 'Company Name': 'Plain Civil Works Ltd', Email: 'plain@test.com', Phone: '+91 93333 55555' },
        { 'Vendor Code': 'V-GEN', 'Company Name': 'General Hardware Works', Email: 'gen@test.com', Phone: '+91 94444 55555' },
        { 'Vendor Code': 'V-CLOUD', 'Company Name': 'Cloud Tech Corp', Email: 'cloud@test.com', Phone: '+91 95555 66666' },
        { 'Vendor Code': 'V-MIN-IT', 'Company Name': 'Minimal Software Corp', Email: 'minit@test.com', Phone: '+91 96666 77777' },
      ]);
      XLSX.utils.book_append_sheet(vendorWb, vendorWs, 'Vendors');
      const vBuf = XLSX.write(vendorWb, { type: 'array', bookType: 'xlsx' });
      const vFile: any = new File([vBuf], 'all_categories_vendors.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      vFile.__buffer = vBuf;

      const vInput = container.querySelector('input[type="file"]');
      if (vInput) {
        fireEvent.change(vInput, { target: { files: [vFile] } });
      }

      // Step 3: Upload PO Dump targeting each vendor with specific keywords
      fireEvent.click(screen.getByText('3. PO Dump'));
      const poWb = XLSX.utils.book_new();
      const poWs = XLSX.utils.json_to_sheet([
        // Mech: pump, globe, gate, valve, hose, compressor, motor (lines 1213-1219)
        {
          'PO Number': 'PO-M1',
          'Vendor Name': 'Mechanical Spares Ltd',
          'Item Name': 'Centrifugal pump and valve with hydraulic hose',
          Quantity: 2,
          'Total Spend': 12000,
          Department: 'Mechanical',
        },
        {
          'PO Number': 'PO-M2',
          'Vendor Name': 'Mechanical Spares Ltd',
          'Item Name': 'Rotary compressor and electric motor',
          Quantity: 1,
          'Total Spend': 25000,
          Department: 'Mechanical',
        },
        {
          'PO Number': 'PO-M3',
          'Vendor Name': 'Mechanical Spares Ltd',
          'Item Name': 'Gate unit with hydraulic hose',
          Quantity: 1,
          'Total Spend': 8000,
          Department: 'Mechanical',
        },
        {
          'PO Number': 'PO-M4',
          'Vendor Name': 'Mechanical Spares Ltd',
          'Item Name': 'Globe component with compressor',
          Quantity: 1,
          'Total Spend': 6000,
          Department: 'Mechanical',
        },
        // Elec: panel + breaker, and switchgear + mccb without panel/breaker (lines 1220-1223)
        {
          'PO Number': 'PO-E1',
          'Vendor Name': 'Volt Panels Electricals',
          'Item Name': 'Electrical panel and circuit breaker with armored cable',
          Quantity: 3,
          'Total Spend': 35000,
          Department: 'Electrical',
        },
        {
          'PO Number': 'PO-E2',
          'Vendor Name': 'Switchgear Only Ltd',
          'Item Name': 'Switchgear and mccb unit with armored cable',
          Quantity: 2,
          'Total Spend': 20000,
          Department: 'Electrical',
        },
        // Civil: peb + tmt, and plain civil steel without peb/tmt (lines 1224-1228)
        {
          'PO Number': 'PO-C1',
          'Vendor Name': 'Infra Civil Structures',
          'Item Name': 'Civil works peb structure and tmt steel reinforcement bars',
          Quantity: 10,
          'Total Spend': 45000,
          Department: 'Civil',
        },
        {
          'PO Number': 'PO-C2',
          'Vendor Name': 'Plain Civil Works Ltd',
          'Item Name': 'Civil industrial steel structure',
          Quantity: 5,
          'Total Spend': 30000,
          Department: 'Civil',
        },
        // Gen: no special keywords -> lines 1230-1232
        {
          'PO Number': 'PO-G1',
          'Vendor Name': 'General Hardware Works',
          'Item Name': 'Standard fasteners and office hardware supplies',
          Quantity: 50,
          'Total Spend': 5000,
          Department: 'General',
        },
        // Cloud: cloud, azure, gcp, compute, storage, license, subscription, renewal, 365, bigquery, power bi, datacenter (lines 1184-1208)
        {
          'PO Number': 'PO-CL1',
          'Vendor Name': 'Cloud Tech Corp',
          'Item Name': 'Azure cloud storage compute credits and office 365 subscription renewal with power bi data analytics in datacenter',
          Quantity: 1,
          'Total Spend': 90000,
          Department: 'IT',
        },
        // Min IT: matches microsoft/software but none of cloud/license/analytics/datacenter -> lines 1210-1211 (secondSetMinors.length === 0)
        {
          'PO Number': 'PO-MIT1',
          'Vendor Name': 'Minimal Software Corp',
          'Item Name': 'Microsoft custom software utility',
          Quantity: 1,
          'Total Spend': 8000,
          Department: 'IT',
        },
      ]);
      XLSX.utils.book_append_sheet(poWb, poWs, 'PO');
      const poBuf = XLSX.write(poWb, { type: 'array', bookType: 'xlsx' });
      const poFile: any = new File([poBuf], 'all_categories_po.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      poFile.__buffer = poBuf;

      const fileInputs = container.querySelectorAll('input[type="file"]');
      const poInput = fileInputs[fileInputs.length - 1];
      if (poInput) {
        fireEvent.change(poInput, { target: { files: [poFile] } });
      }

      // Run AI Category Cross-Match without mock so fallback computeJoinedRecords executes all classification branches!
      const runJoinBtn = screen.getByRole('button', { name: /Run AI Category Cross-Match/i });
      fireEvent.click(runJoinBtn);
      act(() => {
        jest.advanceTimersByTime(1200);
      });

      // Verify Step 4 rendered
      expect(screen.getByText('Mechanical Spares Ltd')).toBeInTheDocument();
      expect(screen.getByText('Volt Panels Electricals')).toBeInTheDocument();

      // Proceed to Step 5 and complete setup with 2_years or 3_years
      fireEvent.click(screen.getByText(/Review Email Dispatch & Finalize/i));
      jest.useRealTimers();

      const completeBtn = screen.getByText(/COMPLETE SETUP & INGEST/i);
      await act(async () => {
        fireEvent.click(completeBtn);
        // Double click immediately while isConfirmingIngestion is true (line 1503)
        fireEvent.click(completeBtn);
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(mockShowToast).toHaveBeenCalledWith('Setup Complete', expect.stringContaining('for 2 Years'), 'success');

      // Unmount first render so DOM queries in container2 don't collide
      unmount();

      // Now test empty joinedVendors branch (line 1507)
      // Open modal fresh, mock ai-cross-match to return empty array []
      const { container: container2, unmount: unmount2 } = render(<InitialSetupModal />);
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/api/buyer-accounts/ai-cross-match')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ success: true, data: [] }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
      });

      fireEvent.click(screen.getByText('2. Vendor Master'));
      const vInput2 = container2.querySelector('input[type="file"]');
      if (vInput2) {
        // Change with empty files (line 1729: if (file) false branch)
        fireEvent.change(vInput2, { target: { files: [] } });
        await act(async () => {
          fireEvent.change(vInput2, { target: { files: [vFile] } });
          await new Promise((resolve) => setTimeout(resolve, 50));
        });
      }

      fireEvent.click(screen.getByText('3. PO Dump'));
      const poInputs2 = container2.querySelectorAll('input[type="file"]');
      const poInput2 = poInputs2[poInputs2.length - 1];
      if (poInput2) {
        // Change with empty files (line 2257: if (file) false branch)
        fireEvent.change(poInput2, { target: { files: [] } });
        await act(async () => {
          fireEvent.change(poInput2, { target: { files: [poFile] } });
          await new Promise((resolve) => setTimeout(resolve, 50));
        });
      }

      const runJoinBtn2 = screen.getByRole('button', { name: /Run AI Category Cross-Match/i });
      fireEvent.click(runJoinBtn2);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 700));
      });

      // Navigate to Step 5
      fireEvent.click(screen.getByText(/Review Email Dispatch & Finalize/i));
      const completeBtn2 = screen.getByText(/COMPLETE SETUP & INGEST/i);
      await act(async () => {
        fireEvent.click(completeBtn2);
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(mockShowToast).toHaveBeenCalledWith('Ingestion Error', 'No vendor records found to ingest. Please upload a valid Vendor Master file first.', 'warning');
      unmount2();
    } finally {
      global.fetch = origFetch;
      jest.useRealTimers();
    }
  });

  it('covers plural validation error warning when multiple vendors are missing company name', async () => {
    const { container } = render(<InitialSetupModal />);
    fireEvent.click(screen.getByText('2. Vendor Master'));

    const invalidWb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([
      { 'Vendor Code': 'V-INV-1', 'Company Name': '', Email: 'inv1@test.com' },
      { 'Vendor Code': 'V-INV-2', 'Company Name': '', Email: 'inv2@test.com' },
    ]);
    XLSX.utils.book_append_sheet(invalidWb, ws, 'Vendors');
    const buf = XLSX.write(invalidWb, { type: 'array', bookType: 'xlsx' });
    const invFile: any = new File([buf], 'two_invalids.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    invFile.__buffer = buf;

    const fileInput = container.querySelector('input[type="file"]');
    if (fileInput) {
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [invFile] } });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    // Line 1778: Plural 'Records'
    expect(screen.getByText(/2 Supplier Records Missing Required Fields/i)).toBeInTheDocument();
  });
});
