interface ISizeCalculationResult {
  width: number;
  height: number;
  type?: string;
  orientation?: number;
  images?: ISizeCalculationResult[];
}

declare const setConcurrency: (c: number) => void;
declare const imageSizeFromFile: (filePath: string) => Promise<ISizeCalculationResult>;

export { ISizeCalculationResult, imageSizeFromFile, setConcurrency };
