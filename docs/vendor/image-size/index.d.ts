interface ISizeCalculationResult {
  width: number;
  height: number;
  type?: string;
  orientation?: number;
  images?: ISizeCalculationResult[];
}

declare const types: string[];
declare function imageSize(input: Uint8Array): ISizeCalculationResult;
declare const disableTypes: (types: string[]) => void;

export { ISizeCalculationResult, disableTypes, imageSize, imageSize as default, types };
