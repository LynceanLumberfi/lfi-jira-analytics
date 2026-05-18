import { useRef, useState } from "react";
import { Upload, CheckCircle, AlertCircle } from "lucide-react";
import { uploadTestCoverageCSV } from "../../lib/api";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";

export function TestCoverageUpload() {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function handleFile(file) {
    if (!file) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const data = await uploadTestCoverageCSV(file);
      setResult(data);
    } catch (e) {
      setError(e.message || "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  function onInputChange(e) {
    handleFile(e.target.files?.[0]);
    e.target.value = "";
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  }

  return (
    <div className="mx-auto max-w-lg py-10">
      <div className="mb-6">
        <h1 className="text-[20px] font-bold text-ink">Test Coverage Import</h1>
        <p className="mt-1 text-[13px] text-ink-3">
          Upload a CSV with columns: Feature, Module, Covered, Total, Date.
          Re-uploading updates existing rows by (Feature, Module).
        </p>
      </div>

      <Card>
        <CardBody pad="lg">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-8 py-12 transition-colors ${
              dragging ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong"
            }`}
          >
            <Upload size={32} className={dragging ? "text-accent" : "text-ink-3"} />
            <div className="text-[14px] font-medium text-ink">
              {loading ? "Uploading…" : "Drop CSV here or click to browse"}
            </div>
            <div className="text-[12px] text-ink-3">Accepts .csv files</div>
            <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={onInputChange} />
          </div>

          {result && (
            <div className="mt-5 flex items-start gap-3 rounded-lg bg-[#f0fdf4] p-4">
              <CheckCircle size={18} className="mt-0.5 shrink-0 text-[#16a34a]" />
              <div>
                <div className="text-[13px] font-semibold text-[#15803d]">Upload successful</div>
                <div className="mt-1 text-[12px] text-[#166534]">
                  {result.total} rows processed · {result.inserted} inserted · {result.updated} updated
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-5 flex items-start gap-3 rounded-lg bg-[#fef2f2] p-4">
              <AlertCircle size={18} className="mt-0.5 shrink-0 text-[#dc2626]" />
              <div>
                <div className="text-[13px] font-semibold text-[#b91c1c]">Upload failed</div>
                <div className="mt-1 text-[12px] text-[#991b1b]">{error}</div>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
