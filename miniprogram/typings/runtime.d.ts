declare const wx: any;
declare function App<T extends object>(options: T & ThisType<T>): void;
declare function Page<T extends { data: Record<string, any> }>(
  options: T & ThisType<T & { setData(data: Partial<T["data"]>): void }>,
): void;
type MiniComponentInstance<Data extends Record<string, any>, Methods extends Record<string, any>> = {
  data: Data;
  setData(data: Partial<Data>): void;
  triggerEvent(name: string, detail?: Record<string, unknown>): void;
} & Methods;
declare function Component<
  Data extends Record<string, any>,
  Methods extends Record<string, (...args: any[]) => any>,
>(options: {
  properties?: Record<string, unknown>;
  data: Data;
  observers?: Record<string, (this: MiniComponentInstance<Data, Methods>, ...args: any[]) => void>;
  lifetimes?: {
    attached?: (this: MiniComponentInstance<Data, Methods>) => void;
    detached?: (this: MiniComponentInstance<Data, Methods>) => void;
  };
  methods: Methods & ThisType<MiniComponentInstance<Data, Methods>>;
}): void;
declare function getApp<T = any>(): T;
declare function getCurrentPages(): any[];
