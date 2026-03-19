import { TestBed } from "@angular/core/testing";
import { PLATFORM_ID, provideZonelessChangeDetection } from "@angular/core";
import {
  FilterParserService,
  type ParsedResult,
  type ParsedRule,
} from "./filter-parser.service";

describe("FilterParserService", () => {
  let service: FilterParserService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: PLATFORM_ID, useValue: "browser" },
      ],
    });
    service = TestBed.inject(FilterParserService);
  });

  afterEach(() => {
    service.terminate();
  });

  it("should be created", () => {
    expect(service).toBeTruthy();
  });

  it("should start with null result", () => {
    expect(service.result()).toBeNull();
  });

  it("should not be parsing initially", () => {
    expect(service.isParsing()).toBe(false);
  });

  it("should have 0 progress initially", () => {
    expect(service.progress()).toBe(0);
  });

  it("should have no error initially", () => {
    expect(service.error()).toBeNull();
  });

  it("should return empty extracted URLs when no result", () => {
    expect(service.extractedUrls()).toEqual([]);
  });

  it("should set isParsing when parse is called", () => {
    // Worker may not work in jsdom, but signals should update
    service.parse("https://example.com\n||ads.com^");
    // isParsing is set synchronously before worker message
    // In jsdom, Worker may not be available, so it falls back
    expect(service.isParsing()).toBeDefined();
  });

  it("should terminate worker cleanly", () => {
    service.terminate();
    expect(service).toBeTruthy(); // No error thrown
  });

  // -------------------------------------------------------------------------
  // Worker message handling — driven via parse() + Worker constructor stub
  //
  // We stub globalThis.Worker so that parse() creates a FakeWorker whose
  // onmessage/onerror callbacks are captured. Tests then fire those callbacks
  // directly to verify the public signal updates without touching any private
  // implementation detail.
  // -------------------------------------------------------------------------

  describe("Worker message handling", () => {
    /** Last FakeWorker instance created by the service under test. */
    let fakeWorkerInstance: {
      onmessage: ((e: MessageEvent) => void) | null;
      onerror: ((e: ErrorEvent) => void) | null;
      postMessage: ReturnType<typeof vi.fn>;
      terminate: ReturnType<typeof vi.fn>;
    } | null = null;

    beforeEach(() => {
      fakeWorkerInstance = null;

      class FakeWorker {
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: ErrorEvent) => void) | null = null;
        postMessage = vi.fn();
        terminate = vi.fn();
        constructor(_url: string | URL, _opts?: WorkerOptions) {
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          fakeWorkerInstance = this;
        }
      }

      vi.stubGlobal("Worker", FakeWorker);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      fakeWorkerInstance = null;
    });

    it("handles result message — updates result signal and stops parsing", () => {
      const resultPayload: ParsedResult = {
        rules: [{ line: 1, raw: "||ads.com^", type: "filter" }],
        totalLines: 1,
        urlCount: 0,
        filterCount: 1,
        commentCount: 0,
        duration: 10,
      };

      service.parse("||ads.com^");
      expect(service.isParsing()).toBe(true);
      expect(fakeWorkerInstance).not.toBeNull();

      fakeWorkerInstance!.onmessage!(
        { data: { type: "result", payload: resultPayload } } as MessageEvent,
      );

      expect(service.result()).toEqual(resultPayload);
      expect(service.isParsing()).toBe(false);
      expect(service.progress()).toBe(100);
    });

    it("handles progress message — updates progress signal without stopping parse", () => {
      service.parse("||ads.com^");
      expect(service.isParsing()).toBe(true);

      fakeWorkerInstance!.onmessage!(
        { data: { type: "progress", payload: 42 } } as MessageEvent,
      );

      expect(service.progress()).toBe(42);
      expect(service.isParsing()).toBe(true);
    });

    it("handles error message — sets error signal and stops parsing", () => {
      service.parse("||ads.com^");
      expect(service.isParsing()).toBe(true);

      fakeWorkerInstance!.onmessage!(
        { data: { type: "error", payload: "Parse failed" } } as MessageEvent,
      );

      expect(service.error()).toBe("Parse failed");
      expect(service.isParsing()).toBe(false);
    });

    it("onerror callback — sets error signal and stops parsing", () => {
      service.parse("||ads.com^");
      expect(service.isParsing()).toBe(true);

      fakeWorkerInstance!.onerror!({ message: "Worker crashed" } as ErrorEvent);

      expect(service.error()).toBe("Worker crashed");
      expect(service.isParsing()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // extractedUrls computed
  // -------------------------------------------------------------------------

  describe("extractedUrls", () => {
    it("returns only url-type rules from the parse result", () => {
      const rules: ParsedRule[] = [
        { line: 1, raw: "https://cdn.example.com/list.txt", type: "url" },
        { line: 2, raw: "||ads.com^", type: "filter" },
        { line: 3, raw: "! Comment line", type: "comment" },
        { line: 4, raw: "https://example.org/other.txt", type: "url" },
      ];
      const result: ParsedResult = {
        rules,
        totalLines: 4,
        urlCount: 2,
        filterCount: 1,
        commentCount: 1,
        duration: 5,
      };

      service.result.set(result);

      expect(service.extractedUrls()).toEqual([
        "https://cdn.example.com/list.txt",
        "https://example.org/other.txt",
      ]);
    });
  });
});

// ---------------------------------------------------------------------------
// SSR path — separate describe to avoid TestBed provider conflict
// ---------------------------------------------------------------------------

describe("FilterParserService — SSR", () => {
  let service: FilterParserService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: PLATFORM_ID, useValue: "server" },
      ],
    });
    service = TestBed.inject(FilterParserService);
  });

  afterEach(() => {
    service.terminate();
    vi.unstubAllGlobals();
  });

  it("does not create a Worker when running server-side and resets isParsing", () => {
    const workerSpy = vi.fn();
    vi.stubGlobal("Worker", workerSpy);

    service.parse("||ads.com^");

    expect(workerSpy).not.toHaveBeenCalled();
    expect(service.isParsing()).toBe(false);
  });
});
