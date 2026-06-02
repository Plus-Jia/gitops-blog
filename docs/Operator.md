# 快速示例

下面我们通过一个极简的 **“Hello World” 级别的 Operator** 来走一遍标准开发流程。这个 Operator 的功能是：监听我们自定义的 `SimplePod` 资源，一旦发现有这个资源，就自动在集群里拉起一个对应的 Pod。

### 第一步：初始化项目环境

在 Linux 开发环境中，新建一个目录并初始化 Kubebuilder 项目：

```bash
mkdir simple-operator && cd simple-operator
# 初始化 Go 模块和 Kubebuilder 项目骨架
go mod init example.com/simple-operator
kubebuilder init --domain example.com --repo example.com/simple-operator
```

对于`kubebuilder init --domain example.com --repo example.com/simple-operator`

- --domain example.com：域（Domain)。决定了以后创建的 API 组（group)的后缀。

  ```
  apiVersion: webapp.example.com/v1  # 这里 webapp 是 Group，example.com 是 Domain
  kind: Guestbook
  ```

- --repo example.com/simple-operator：GO 模块名

运行这条命令后，Kubebuilder 会在当前目录下生成一堆文件。这些文件构成了 Operator 的**脚手架**：

1. **`go.mod` & `go.sum`**: Go 项目的依赖管理文件，已经帮你配置好了 `controller-runtime` 等核心库。
2. **`PROJECT`**: Kubebuilder 的元数据文件，记录了你的域名和项目配置。
3. **`Makefile`**: 极其重要的工具集。你可以用它来 `make build`（编译）、`make install`（安装 CRD）或者 `make deploy`（部署到集群）。
4. **`main.go`**: 整个控制器的入口。它负责初始化 **Manager**，Manager 就像是一个大管家，管理着以后你要写的各种控制器（Controller）。
5. **`config/` 目录**: 里面包含了一整套 **Kustomize** 配置文件，用于将你的 Operator 部署到 Kubernetes 集群中（包括 RBAC 权限、Service 等）。

### 第二步：创建 API（CRD + Controller）

我们要创建一个 API 组（Group）叫 `webapp`，版本（Version）是 `v1`，资源种类（Kind）叫 `SimplePod`。

```bash
kubebuilder create api --group webapp --version v1 --kind SimplePod
```

*命令行会提示是否创建 Resource 和 Controller，两次都输入 `y` 并回车。*

执行完后，你会发现项目里多了两个核心文件，这就是你接下来要写代码的地方：

1. `api/v1/simplepod_types.go`：定义资源结构。
2. `internal/controller/simplepod_controller.go`：编写控制逻辑。

### 第三步：定义期望状态（修改 CRD 结构）

打开 `api/v1/simplepod_types.go`，找到 `SimplePodSpec`。我们在这里定义用户可以传入什么参数，比如只需指定一个容器镜像：

```go
// api/v1/simplepod_types.go

type SimplePodSpec struct {
    // 明确告诉 Controller 我们期望使用什么镜像
    Image string `json:"image,omitempty"`
}

type SimplePodStatus struct {
    // 记录当前状态，例如：Pending, Running
    Phase string `json:"phase,omitempty"`
}
```

修改完成后，执行 `make manifests`。Kubebuilder 会根据你的 Go 代码注释和结构体，自动生成标准的 K8s YAML 文件（存放在 `config/crd/bases` 目录下）。

解析：

`SimplePodSpec`：期望状态 (Desired State)

- `Image string`：定义了一个字符串类型的变量，用于接收用户输入的镜像名称，比如 `"nginx:latest"`
- `json:"image,omitempty"`：
  - go 语言的 Tag。kubernetes 的 API 交互主要基于 JSON/YAML 的。
  - `json:"image"`：告诉 JSON 序列化/反序列化器，当把这个结构体转换成 YAML/JSON 时，这个字段的名字叫小写的 `image`。这就是为什么在 YAML 里写的是 `image: nginx` 而不是 `Image: nginx`。
  - `omitempy`：意思是“如果用户没有填写这个字段（也就是字符串为空`""`时），在生成 JSON/YAML 时就忽略它，不要输出一个 `image: ""` 的键值对“。这能让资源对象保持整洁。

`SimplePodStatus`：实际状态 (Actual/Current State)

### 第四步：编写核心调谐逻辑（Reconcile）

这是 Operator 的灵魂。打开 `internal/controller/simplepod_controller.go`，重点看 `Reconcile` 函数。K8s 中的任何相关事件（创建、更新、删除），都会触发这个函数。

我们来实现极简逻辑：读取 `SimplePod` 里的 Image -> 检查真实 Pod 存不存在 -> 不存在就创建一个。

```go
// internal/controller/simplepod_controller.go

import (
    corev1 "k8s.io/api/core/v1"
    metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
    // ... 其他默认导入
)

func (r *SimplePodReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    logger := logf.FromContext(ctx)

    // 1. 获取用户创建的 SimplePod 实例
    var sp webappv1.SimplePod
    if err := r.Get(ctx, req.NamespacedName, &sp); err != nil {
        // 如果找不到，说明可能被删除了，忽略报错
        return ctrl.Result{}, client.IgnoreNotFound(err)
    }

    // 2. 检查真实的 Pod 是否已经存在
    var pod corev1.Pod
    err := r.Get(ctx, req.NamespacedName, &pod)
    
    if err != nil && client.IgnoreNotFound(err) == nil {
        // 3. Pod 不存在，我们期望状态是存在，所以需要创建它
        logger.Info("Creating a new Pod", "Pod.Namespace", sp.Namespace, "Pod.Name", sp.Name)
        
        newPod := &corev1.Pod{
            ObjectMeta: metav1.ObjectMeta{
                Name:      sp.Name,
                Namespace: sp.Namespace,
            },
            Spec: corev1.PodSpec{
                Containers: []corev1.Container{{
                    Name:  "main-container",
                    Image: sp.Spec.Image, // 使用用户在 CRD 中定义的镜像
                }},
            },
        }
        
        // 将新建的 Pod 归属权绑定给 SimplePod（这样删除 SimplePod 时，Pod 会被级联删除）
        ctrl.SetControllerReference(&sp, newPod, r.Scheme)
        
        if err := r.Create(ctx, newPod); err != nil {
            return ctrl.Result{}, err
        }
        return ctrl.Result{Requeue: true}, nil
    } else if err != nil {
        return ctrl.Result{}, err
    }

    // 4. Pod 已经存在，状态一致，结束本次调谐
    logger.Info("Pod already exists, skipping creation")
    return ctrl.Result{}, nil
}
```

**注意底部的 SetupWithManager 函数：** 确保你在这里告诉了 Controller，除了监听 `SimplePod`，还要监听它所拥有的 `Pod` 资源：

```go
func (r *SimplePodReconciler) SetupWithManager(mgr ctrl.Manager) error {
    return ctrl.NewControllerManagedBy(mgr).
        For(&webappv1.SimplePod{}).
        Owns(&corev1.Pod{}). // 加上这一行，当底下管理的 Pod 发生变化时也会触发 Reconcile
        Complete(r)
}
```

#### **解析**

##### **import**

**`corev1 "k8s.io/api/core/v1"`（核心资源包）**

在写 YAML 时，我们经常写 `apiVersion: v1` 和 `kind: Pod`。`corev1` 就是这个 v1 API 组在 Go 语言里的具体实现。它包含了所有 Kubernetes 的核心源的结构体定义，比如Pod、Service、ConfigMap、Secret等等。比如当想要在 Go 代码里组装一个 Pod，就会用到 `corev1.pod{}`。当想要设置容器镜像，就会用 `corev1.Container{}`。

**`metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"`（元数据包）**

每一份标准 YAML 文件中，都有一个 metadata 模块（包含 name, namespace, labels, annotations）。

Kubernetes 把这种所有资源都通用的“元数据”抽离到了 `apimachinery` 这个底层核心库中。`metav1` 提供了操作这些元数据的标准类型。**对应关系**：在 YAML 里写的 `metadata: ...`，在 Go 代码里就是 `metav1.ObjectMeta{}`。

`sigs.k8s.io/controller-runtime/pkg/client`

这个包是你和 Kubernetes 集群打交道的**唯一指定通讯器**。代码里写的 `r.Get`、`r.Create`，全都是它提供的能力。

内部机制一：读写分离：

1. 读操作 (`Get`, `List`) 走本地缓存：

   默认情况下，所有的读取操作**绝对不会**通过网络发给 API Server，而是直接从运行你 Operator 的这台机器的本地内存（Cache）里拿数据。Client 底层悄悄运行着 Informer 机制，它和 API Server 保持着长连接。只要集群里有动作，API Server 会主动推数据过来，更新本地内存。

2. 写操作 (`Create`, `Update`, `Delete`, `Patch`) 穿透网络：

   因为写入必须是权威的、最终的，所以这些写操作会绕过缓存，**直接通过 HTTP POST/PUT/DELETE 请求发往真实的 API Server**。

内部机制二：三个核心操作：

1. 批量查询：`r.List`

   当不是找某一个特定的资源，而是想找“一批”资源时用它。你需要先准备一个 `xxxList` 类型的空盒子。

   ```go
   // 准备一个空盒子
   var podList corev1.PodList
   
   // 查 default 命名空间下，所有带有 app=nginx 标签的 Pod
   err := r.List(ctx, &podList, 
       client.InNamespace("default"), 
       client.MatchingLabels{"app": "nginx"},
   )
   
   for _, p := range podList.Items {
       logger.Info("找到 Pod", "名字", p.Name)
   }
   ```

2. 更新资源：`r.Update`

   当获取到一个对象，修改了它的某些配置字段（比如加了标签，或者调整了副本数），需要把改动存回去。

   ```go
   // 假设已经通过 r.Get 拿到了 pod
   pod.Labels["new-label"] = "hello-world"
   err := r.Update(ctx, &pod)
   ```

3. 删除资源：`r.Delete`

   ```go
   // 假设已经通过 r.Get 拿到了 pod
   err := r.Delete(ctx, &pod)
   ```

内部机制三:过滤选项 

在上面 `r.List` 的例子里，我传入了额外的参数 `client.InNamespace` 和 `client.MatchingLabels`。这是 Go 语言中经典的**可变参数选项模式**。

在 `pkg/client` 包里，有很多这类用来修饰请求的工具：

- `client.InNamespace("xxx")`：将操作限定在特定的命名空间。
- `client.MatchingLabels{"key":"value"}`：通过标签过滤对象。
- `client.MatchingFields{"status.phase":"Running"}`：通过字段过滤（注意：字段过滤比较特殊，需要提前在 Manager 里为该字段建索引）。
- `client.Limit(10)`：常用于 List，每次只取 10 条，避免内存撑爆。

内部机制四:更新 Status：

在 Kubernetes 的设计理念中，修改对象的 `Spec`（期望图纸）和修改 `Status`（实际状态反馈）是物理隔离的两个接口（Subresource）。

如果你想把 `SimplePod` 的状态改成 `Running`，你**不能**直接用 `r.Update`：

```go
// ❌ 错误做法：直接 Update 整个对象，API Server 会直接忽略你对 Status 的修改！
sp.Status.Phase = "Running"
r.Update(ctx, &sp)

// ✅ 正确做法：必须调用专用的 Status 客户端！
sp.Status.Phase = "Running"
r.Status().Update(ctx, &sp)
```

- **为什么搞这么麻烦？** 这是为了**权限隔离 (RBAC)**。普通用户可以改 `Spec`（提需求），但不能自己瞎写 `Status`。只有 Controller 自己，才有权限去修改这个资源的 `Status`（汇报真实结果）。

**`ctrl "sigs.k8s.io/controller-runtime"`**

Kubernetes 官方维护的 `controller-runtime` 库。是 Kubebuilder 打造的“一站式开发者工具箱”。

在 Kubebuilder 诞生之前，如果想开发一个 Operator（当时叫自定义控制器），开发者必须直接使用底层的 `client-go` 库。需要手动编写和管理一堆复杂的底层组件：

- Informer（监听 API Server 的组件）

- Lister（本地缓存）

- WorkQueue（事件限速队列）

- 各种 Event Handler（处理增删改的回调函数）

- Roconcile

ubernetes 社区（SIG）的工程师们把上述所有复杂的底层逻辑全部封装了起来，做成了 `controller-runtime` 这个库。主要包含：

1. 核心数据结构 (`ctrl.Request` & `ctrl.Result`)
   把复杂的事件流浓缩成了最简单的“名字”和“下一步指令”。

2. Manager (`ctrl.Manager`)

   如果打开项目根目录下的 `cmd/main.go`，你会看到这样一行：

   ```go
   mgr, err := ctrl.NewManager(ctrl.GetConfigOrDie(), ctrl.Options{...})
   ```

   Manager 是整个 Operator 的核心。当你执行 `make run` 时，就是 Manager 在负责：

   - 读取 `~/.kube/config` 连接集群。
   - 在本地内存中建立集群资源的 Cache（缓存），这样 `r.Get` 就不需要每次都去询问 API Server，而是直接极速读取本地内存。
   - 同时启动并管理你写的所有 Controller。

3. 属主关系绑定 (`ctrl.SetControllerReference`)

   ```go
   ctrl.SetControllerReference(&sp, newPod, r.Scheme)
   ```

   它封装了 Kubernetes 原生的 OwnerReference 机制，一行代码就能建立“父子级联删除”关系。

4. 注册中心 (`ctrl.NewControllerManagedBy`)

   在 `simplepod_controller.go` 的最下面：

   ```go
   func (r *SimplePodReconciler) SetupWithManager(mgr ctrl.Manager) error {
       return ctrl.NewControllerManagedBy(mgr).
           For(&webappv1.SimplePod{}).
           Owns(&corev1.Pod{}).
           Complete(r)
   }
   ```

   这段代码使用的是 `ctrl` 提供的“建造者模式（Builder Pattern）”。它非常优雅地告诉 Manager：

   > “帮我启动这个 Controller。我主要负责监听 (`For`) SimplePod 资源，同时我也拥有 (`Owns`) Pod 资源，它们有变动也请通知我。”

##### Reconcile 函数

###### **函数签名**

```go
func (r *SimplePodReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error)
```

- `(r *SimplePodReconciler)`

  SimplePodReconciler 这个结构体在同一个文件顶部定义，里面装着控制器和与k8s集群交互的工具

  - r.Client：一个 K8s 客户端，增删改查全依靠它（r.Get,r.Create,r.Update,r.Delete）。
  - r.Scheme：可以理解为字典，记录了 Go 里的数据结构比如 `SimplePod`）和 K8s 里的资源类型（GVK）是怎么对应的。

- ctx context.Context：上下文与追踪

  这是 Go 语言的标准库特性。在 Kubernetes 控制器里，ctx 主要承担两个任务：

  1. 超时与取消控制：如果 Reconcile 逻辑里需要调用外部 API，或者查询数据库，K8s 会通过 ctx 来控制超时，防止控制器卡死。
  2. 携带日志信息：通常会在函数第一行写 logger := log.FromContext(ctx)。不仅能打日志，还能自动带上追踪 ID (TraceID)，方便以后在海量日志里排错。

- `req ctrl.Request`

  这是容易产生误解的地方，误认为 req 里面包含用户真实操作记录，比如用户发起了 CREATE 事件。

  但其实 ctrl.Request 源码里面只有两个字符串：

  - NamespacedName.Namespace（命名空间）
  - NamespacedName.Name（资源名称）

  没有任何事件类型，没有任何资源内容。这就是 K8s 著名基于状态而不是基于事件的哲学。如果把具体事件发送过来，万一控制器宕机，中间错过了 n 个事件，系统状态就永远错乱了。

  k8s 做法是：资源发生变化，就把资源名字（Name/Namespace）扔进队列。控制器拿到名字后，去集群查（r.Get)真实状态，然后对比期望。

- `(ctrl.Result, error)`

  它唯一的作用就是告诉 Kubernetes 的工作队列（WorkQueue）：“我这次处理完了，你接下来打算拿我怎么办？”它的整个结构体**只有两个字段**：

  ```go
  // Result 包含调谐器（Reconciler）的返回结果
  type Result struct {
      // Requeue 告诉 Controller 立刻将这个请求重新塞回队列。
      // 注意：如果你返回了一个 error，这个字段会被自动忽略（因为报错会自动重试）。
      Requeue bool
  
      // RequeueAfter 告诉 Controller 在经过一段指定的时间后，再把请求塞回队列。
      RequeueAfter time.Duration
  }
  ```

  Reconcile 函数执行完后，必须告诉 Controller Manager 接下来怎么办，所以有四种回答方式，见下面Reconcile 的返回值部分。

###### 关键代码

```go
logger := logf.FromContext(ctx)

    // 1. 获取用户创建的 SimplePod 实例
    var sp webappv1.SimplePod
    if err := r.Get(ctx, req.NamespacedName, &sp); err != nil {
        // 如果找不到，说明可能被删除了，忽略报错
        return ctrl.Result{}, client.IgnoreNotFound(err)
    }
```

`logger := logf.FromContext(ctx)`：带追踪上下文的日志

在分布式系统和 Kubernetes 开发中，千万**不要**使用标准的 `fmt.Println`，也不要随便 `log.Printf`。

Kubebuilder 提供的 `log.FromContext(ctx)` 会自动从 `ctx`（上下文）中提取当前正在处理的资源信息（比如这个资源的 Namespace 和 Name），甚至是 TraceID。

当你使用 `logger.Info("doing something")` 打印日志时，它会自动带上前缀标签。如果你的集群里同时有几千个 `SimplePod` 在并发运行，你可以通过日志标签一眼看出这条日志是属于哪个具体实例的。

`var sp webappv1.SimplePod` 与 `r.Get(...)`：经典的“空壳填充”模式

首先在内存里声明了一个空的结构体变量 `sp`。然后调用 `r.Get`，把要找的资源名字（`req.NamespacedName`）和这个空结构体的**内存地址指针**（`&sp`）传进去。 `r.Client` 会去 Kubernetes 的本地缓存（Cache）里寻找名字匹配的 `SimplePod`。如果找到了，就会把真实的 YAML 数据反序列化，填充到 `sp` 变量里。在这行代码之后，就可以放心地使用 `sp.Spec.Image` 或 `sp.Namespace` 了。

`if err := r.Get(ctx, req.NamespacedName, &sp); err != nil`

标准函数定义：

```go
func (c client.Client) Get(ctx context.Context, key client.ObjectKey, obj client.Object, opts ...client.GetOption) error
```

当 `r.Get` 返回 `err != nil` 时，通常属于以下三类情况之一：

- 资源不存在 (404 Not Found)：
  - 现象：这是最常见的情况。正如之前讨论的，当资源被删除或尚未创建时，会报这个错。
  - 内部表现：它是一个符合 `apierrors.IsNotFound(err)` 判断的特定错误类型。
- 连接/超时错误 (Connection Refused/Timeout)：
  - 现象：如果你的 `make run` 突然断开了与 Minikube 的连接，或者网络极其拥塞。
  - 内部表现：通常是底层的 TCP 连接错误或上下文（Context）超时。
- 权限拒绝 (403 Forbidden)：
  - 现象：如果你的 ServiceAccount 没有查看该资源的 RBAC 权限。
  - 内部表现：API Server 返回 403，告知你无权访问。

`client.IgnoreNotFound(err)`：Kubernetes 防死循环设计

”既然没找到资源，为什么要把报错忽略掉，而不是直接报错让系统重试？”

设想以下场景：

1. 用户在终端执行了 `kubectl delete simplepod my-test`。
2. Kubernetes 把这个资源删除了。
3. 因为发生了“删除”变动，Kubernetes 往你的队列里塞入了一个请求：`"请去调谐一下 my-test"`。
4. 你的 `Reconcile` 醒来，执行到 `r.Get` 试图获取 `my-test`。
5. 结果：报错 404 NotFound，因为资源刚刚已经被删了！

**如果不忽略这个报错（直接 `return ctrl.Result{}, err`）：** K8s 看到返回了 `err`，会认为你处理失败了。它会不断地、无限期地重启 `Reconcile` 重试，导致 CPU 飙升，陷入**死循环**（因为它永远也找不到那个已经被删掉的资源了）。

**使用 `client.IgnoreNotFound(err)` 的效果：** 这个函数的作用是：如果错误是 “Not Found (404)”，它就返回 `nil`（无错误）；如果是其他网络错误（比如连不上数据库），它照样返回真实的错误。 这样一来，当资源被删除时，Controller 会返回 `ctrl.Result{}, nil`，平静地结束这次调谐。

```go
func (r *SimplePodReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    logger := log.FromContext(ctx)

    // 1. 获取用户创建的 SimplePod 实例
    var sp webappv1.SimplePod
    if err := r.Get(ctx, req.NamespacedName, &sp); err != nil {
        // 如果找不到，说明可能被删除了，忽略报错
        return ctrl.Result{}, client.IgnoreNotFound(err)
    }

    // 2. 检查真实的 Pod 是否已经存在
    var pod corev1.Pod
    err := r.Get(ctx, req.NamespacedName, &pod)
    
    if err != nil && client.IgnoreNotFound(err) == nil {
        // 3. Pod 不存在，我们期望状态是存在，所以需要创建它
        logger.Info("Creating a new Pod", "Pod.Namespace", sp.Namespace, "Pod.Name", sp.Name)
        
        newPod := &corev1.Pod{
            ObjectMeta: metav1.ObjectMeta{
                Name:      sp.Name,
                Namespace: sp.Namespace,
            },
            Spec: corev1.PodSpec{
                Containers: []corev1.Container{{
                    Name:  "main-container",
                    Image: sp.Spec.Image, // 使用用户在 CRD 中定义的镜像
                }},
            },
        }
        
        // 将新建的 Pod 归属权绑定给 SimplePod（这样删除 SimplePod 时，Pod 会被级联删除）
        ctrl.SetControllerReference(&sp, newPod, r.Scheme)
        
        if err := r.Create(ctx, newPod); err != nil {
            return ctrl.Result{}, err
        }
        return ctrl.Result{Requeue: true}, nil
    } else if err != nil {
        return ctrl.Result{}, err
    }

    // 4. Pod 已经存在，状态一致，结束本次调谐
    logger.Info("Pod already exists, skipping creation")
    return ctrl.Result{}, nil
}
```

1. `r.Get` 查 Pod

   ```go
   var pod corev1.Pod
   err := r.Get(ctx, req.NamespacedName, &pod)
   ```

   用到了之前的“空壳填充”模式，只不过这次要找的不是 `SimplePod`，而是真实的 Kubernetes `Pod`。

   - 注意 `req.NamespacedName` 这个参数：这意味着我们期望**创建的 Pod 的名字和命名空间，与 SimplePod 完全保持一致**（比如 SimplePod 叫 `test-pod`，那底下的 Pod 也叫 `test-pod`）。这种 1:1 的映射是 Operator 开发中最常见的模式。

   这里讲一讲为什么两次同样的get获取的内容不一样，其实这取决于第三个参数。在k8s中，查询一个资源需要三个因素（GVK+Namespace+Name）

   - 去哪里找，由`req.NamespaceName` 提供（比如`default/myapp)
   - 找什么类型的资源，这由第三个参数（接收变量的指针类型）来自动判断

   第一次 `GET`:

   ```
   var sp webappv1.SimplePod
   err := r.Get(ctx, req.NamespacedName, &sp)
   ```

   当把 &sp（一个指向 `SimplePod` 结构体的指针）传给 `r.Get` 时，底层的 Client 会利用 Go 的反射机制：发现要找 SimplePod 类型的资源，名字叫 `my-app`，在 `default` 命名空间，于是去 API Server `/apis/[webapp.example.com/v1/namespaces/default/simplepods/my-app](https://webapp.example.com/v1/namespaces/default/simplepods/my-app)` 路径下帮取数据。”

   第二次 `GET`:

   ```go
   var pod corev1.Pod
   err := r.Get(ctx, req.NamespacedName, &pod)
   ```

   这次把 &pod（一个指向原生 Pod 结构体的指针）传进去了。于是这次找的是一个 `Pod` 类型的资源，名字也叫 `my-app` ，在 `default` 命名空间下。于是去 API Server 的 `/api/v1/namespaces/default/pods/my-app` 取数据。

2. Kubernetes Go 开发中最经典的判断语句

   ```go
   if err != nil && client.IgnoreNotFound(err) == nil {
   ```

   - `err != nil`：查询确实报错了，说明没有顺利拿到 Pod。

   - `client.IgnoreNotFound(err) == nil`：把这个报错放进 `IgnoreNotFound` 函数里过滤一下。如果过滤后变成了 `nil`（无错误），**说明刚才那个错误仅仅是因为 404 Not Found（找不到资源）**。

3. 在内存中“组装”一个 Pod

   ```go
   newPod := &corev1.Pod{
       ObjectMeta: metav1.ObjectMeta{
           Name:      sp.Name,
           Namespace: sp.Namespace,
       },
       Spec: corev1.PodSpec{
           Containers: []corev1.Container{{
               Name:  "main-container",
               Image: sp.Spec.Image, // 灵魂注入！
           }},
       },
   }
   ```

   这段代码并没有真正去 K8s 里创建对象，它只是在 Go 的内存里初始化了一个指向 `corev1.Pod` 的指针（`&`）。

   这里体现了在 CKA 中手写 YAML 的功底，只不过换成了 Go 语言的结构体嵌套：

   - **`metav1.ObjectMeta`**：我们在元数据里，把刚才 `SimplePod` (`sp`) 的名字和命名空间原封不动地赋给了新 Pod。
   - **`corev1.PodSpec`**：这是最核心的一行 `Image: sp.Spec.Image`。我们在 `types.go` 里定义的蓝图，在这里终于被转化为了原生 Pod 的参数！用户在 CRD 里填写的 `nginx:alpine`，通过 `sp` 这个变量传递给了真实的容器镜像。

4. SetControllerReference

   ```go
   ctrl.SetControllerReference(&sp, newPod, r.Scheme)
   ```

   级联删除：当执行 `kubectl delete deployment my-app` 时，它底下的 ReplicaSet 和 Pod 都会被自动清理掉。这背后就是 **OwnerReference（属主引用）**。

   - **这行代码在干什么？** 它在修改 `newPod.ObjectMeta.OwnerReferences` 字段。它明确告诉 Kubernetes：`sp`（我们自定义的 SimplePod）是 `newPod` 的“父亲”。

   - **`r.Scheme` 的作用：** Kubernetes 需要知道 `sp` 的GVK（Group, Version, Kind），`r.Scheme` 是注册表，负责把 Go 结构体翻译成 Kubernetes 认识的 API 资源标签。

   - **收益：** 只要加了这一行，就**完全不需要**去写任何清理 Pod 的代码。当用户删除 SimplePod 时，Kubernetes 的 kube-controller-manager 里的垃圾回收器（Garbage Collector）会顺藤摸瓜，自动帮你把这个 Pod 杀掉

5. 真正的动作执行 (`r.Create`）

   ```go
   if err := r.Create(ctx, newPod); err != nil {
       return ctrl.Result{}, err
   }
   ```

   经过前面漫长的查询、判断、组装，这里终于发起了真实的 HTTP POST 请求给 API Server。 如果在这个过程中报错（比如 Namespace 不存在，或者配额超了），就原封不动地返回 `err`，让 Manager 按照指数退避机制重试。

6. 架构精髓：为什么创建完要 `Requeue: true`？

   ```go
   return ctrl.Result{Requeue: true}, nil
   ```

   既然 Pod 已经发送创建请求并且没报错了，事情不就办完了吗？为什么还要 `Requeue: true`（立刻重新塞回队列，再执行一次 Reconcile）？

   这是因为 Kubernetes 是一个异步的最终一致性系统。

   - `r.Create` 成功，**仅仅**代表 API Server 接受了你的图纸，并把它存进了 etcd。
   - 此时 Pod 可能还在调度中（Pending），甚至可能因为镜像拉不到而失败（ImagePullBackOff）。
   - 返回 `Requeue: true`，就是让 Controller 马上再查一次。在下一次的 `Reconcile` 循环中，代码会走到 `r.Get` 去查真实 Pod，这时候就能查到 Pod 存在了。
   - 在更完善的 Operator 里，我们通常会在查到 Pod 存在后，去读取 Pod 的状态（比如是不是 Running），然后把这个状态更新到 `SimplePod.Status.Phase` 里，汇报给用户。

7. 最后

   ```go
   // 4. Pod 已经存在，状态一致，结束本次调谐
   logger.Info("Pod already exists, skipping creation")
   return ctrl.Result{}, nil
   ```




###### SetupWithManager 函数

```go
func (r *SimplePodReconciler) SetupWithManager(mgr ctrl.Manager) error {
    return ctrl.NewControllerManagedBy(mgr).
        For(&webappv1.SimplePod{}).
        Owns(&corev1.Pod{}). // 加上这一行，当底下管理的 Pod 发生变化时也会触发 Reconcile
        Complete(r)
}
```

这个函数主要是告诉 K8s 谁负责监听什么资源，发生变化时该调用谁处理。

Operator 运行是会管理多个 controller，这里的只是一个 contorller

这里SetupWithManager是在

- 创建一个 controller 让 manager 管理：

  ```
  ctrl.NewControllerManagedBy(mgr)
  ```

- 监听什么资源

  ```
  .For(&webappv1.SimplePod{})
  ```

  监听 SimplePod 资源。即发生变化（create,update,delete）时，都通知这个 controller。

- 谁来处理事件

  ```go
  .Complete(r)
  ```

  当监听到事件后，用 r 来处理。而 `r *SimplePodReconciler`里面最重要的方法就是`Reconcile(...)`，所以：

  ```
  资源变化
      ↓
  controller 收到事件
      ↓
  调用：
  r.Reconcile(...)
  ```

SetupWithManager 不是业务逻辑。而是 “注册阶段”。



###### **Controller 必须理解的 4 个核心概念:**

1. 调谐（Reconcile）是基于状态，而不是事件

   - **错误的直觉**：“用户发起了一个 Create 操作，所以我写一段代码去响应这个 Create；用户发起了 Update，我去响应 Update。”
   - **K8s 的真实逻辑**：Controller 并不关心到底发生了什么具体动作。`Reconcile` 被触发时，它只拿到一个线索（资源的 Namespace 和 Name）。你的代码需要每次都去集群里查：**“现在集群里是个什么状况？和我想象的（Spec）一样吗？”** 如果缺了就建，如果多了就删，如果不一致就改。

2.  “增删改查”全靠 Client (`r.Get`, `r.Create`, `r.Update`)
   在终端我们是通过类似命令 `kubectl get pods` 获取信息。在 Controller 代码里，我们调用 `r.Get()`。
   kuberbuider 已经初始化好了一个与 API Server 通信的客户端。我们需要习惯这种写法：先声明一个空的结构体对象，然后用 `r.Get` 把真实数据填充进去。

   ```
   // 声明一个空的 Pod 对象
   var pod corev1.Pod
   // 去集群里查，如果找到了，就把数据塞进 pod 变量里
   err := r.Get(ctx, types.NamespacedName{Name: "my-pod", Namespace: "default"}, &pod)
   ```

3. 属主与级联删除
   删除 `SImplePod` 时，底下 Pod 也被自动删除。这是依赖于 k8s 的垃圾回收机制。
   在代码中，必须显式地确立这种父子关系：

   ```
   // 告诉 k8s：这个 newPod 是由 sp（SimplePod）拥有的
   ctrl.SetControllerReference(&sp, newPod, r.Scheme)
   ```

   这样不仅能实现级联删除，还能在子资源（Pod）状态发生变化时，反向触发父资源（SimplePod）的 Reconcile，这也是 Kubebuilder 封装好的强大功能。

4. Reconcile 的返回值
   `Reconcile` 必须告诉 Kubernetes 管理器接下来该怎么办：

   - `return ctrl.Result{}, nil`：调谐成功，当前状态一切完美，去休息吧，直到下次资源变动再叫醒我。

   - `return ctrl.Result{}, err`：出错了！管理器会采用指数退避的方式（过 1秒、2秒、4秒...）**自动重试**，再次调用你的 Reconcile。

   - `return ctrl.Result{Requeue: true}, nil`：这次处理完了，但是流程没走完（比如刚才刚发出了创建 Pod 的请求，Pod 还没 Running），**立刻重试一次**。

   - `return ctrl.Result{RequeueAfter: time.Minute}, nil`：事情做完了，但请在 **1 分钟后**再来调谐一次（常用于定期巡检、定时同步外部数据等场景）。
   
     

### 第五步：本地运行与测试

在部署到线上之前，你完全可以把 Operator 作为一个普通的 Go 程序在你本地机器上跑起来调试（只要你的机器能连上 K8s 集群的 `~/.kube/config`）。

1. **将生成的 CRD 安装到你的测试集群：**

   ```go
   make install
   ```

2. **在本地终端前台运行 Controller：**

   ```go
   make run
   ```

   实际上发生了这三件事：

   1. 编译代码：把 `simplepod_controller.go` 里代码编译成可执行文件
   2. 连接集群：读取~/.kube/config 文件，获取管理器权限，连接到 k8s API Server
   3. 开始死循环监听：这个程序变成了一个监听器（Informer）

   如果 ctrl+c 停止：

   1. crd 还在，因为之前执行过 make Install ，k8s API Server 依然认识什么是 SimplePod
   2. 之前通过 Operator 创建的 Pod 还会继续运行
   3. kubectl apply 提交的实例继续存在

   但：

   1. 自愈能力丧失
   2. 不在响应新请求

   原因：

   这个 Controller 是跑在刚刚的终端中，生产环境会把这个go程序打包成镜像，然后作为一个 Deployment 部署到集群。

3. **测试资源：** 新开一个终端，创建一个 YAML 文件 `sample.yaml`：

```yaml
   apiVersion: webapp.example.com/v1
   kind: SimplePod
   metadata:
     name: my-first-simplepod
     namespace: default
   spec:
     image: nginx:latest
```

应用它：`kubectl apply -f sample.yaml`

也可以在config/samples 下面有示例yaml,改一改：

```
apiVersion: webapp.example.com/v1
kind: SimplePod
metadata:
  labels:
    app.kubernetes.io/name: simple-operator
    app.kubernetes.io/managed-by: kustomize
  name: test-simplepod
spec:
  # 确保这里的字段名 Image 大写正确，并给一个镜像名
  image: nginx:alpine
```

这时候你去观察跑着 `make run` 的终端，会看到日志打印 `Creating a new Pod`。 你可以使用 `kubectl get pods`，就会发现集群里已经多了一个叫 `my-first-simplepod` 的 Nginx Pod 了！

清理

```
make uninstall
```



### 总结

Operator 开发的最核心路径：

- **脚手架生成** (`kubebuilder init/create api`)
- **模型定义** (`types.go`)
- **逻辑实现** (`controller.go`)
- **集群部署** (`make install`)
- **本地调试** (`make run`)



部署 Controller

这里使用的集群是 minikube，但流程没有改变，都是构建镜像，然后部署该镜像

1. 镜像构建

   ```
   make docker-build  IMG=simplepod-controller:v1
   ```

2. 镜像导入minikube

   ```
   minikube image load IMG=simplepod-controller:v1
   ```

   可以检测一下有没有导入

   ```
   minikube image ls | grep application-operator
   ```

3. 部署控制器

   这一步会利用 `kustomize` 自动生成一整套清单（包括 Deployment、RBAC 角色、ServiceAccount），并将它们安装到 `simplepod-system` 命名空间。

   ```
   make deploy  IMG=simplepod-controller:v1
   ```

4. 检查成果

   **查看命名空间**：`make deploy` 会创建一个名为 `application-operator-system` 的空间。

   ```
   kubectl get ns
   ```

   **查看控制器状态**：

   ```
   kubectl get pods -n application-operator-system
   ```

   **观察日志**（这就像是集群里的 `make run` 输出）：

   ```
   kubectl logs -f deployment/application-operator-controller-manager -n application-operator-system -c manager
   ```

   

清理

```
# 卸载 Controller
make undeploy
# 卸载CRD
make uninstall
```

​	

# 使用 Kubernetes API

## curl 方式访问 API

#### 实验一：使用 `kubectl proxy` (本地快速调试)

这是最简单的调用方式。`kubectl proxy` 会在本地启动一个 HTTP 代理服务器，它会自动使用你 `~/.kube/config` 中的凭证与 API Server 通信。

**操作步骤：**

1. **启动代理（在后台运行）：**

   ```
   kubectl proxy --port=8080 &
   ```

   *预期输出：`Starting to serve on 127.0.0.1:8080`*

2. **使用 curl 访问 API 根路径：**

   ```
   curl http://127.0.0.1:8080/api/
   ```

   *会看到可用的 API 版本列表。*

3. **获取 default 命名空间下的 Pod 列表：**

   ```bash
   curl http://127.0.0.1:8080/api/v1/namespaces/default/pods
   ```

4. **清理代理：**

   ```bash
       # 找到刚才后台运行的 proxy 进程并结束它
       kill %1

#### 相关知识

**GVR 是为了“找到”资源**：就像是文件系统里的**路径**。API Server 依靠 GVR 来决定将请求路由到哪个控制器（Controller）。

**GVK 是为了“定义”资源**：就像是编程语言里的**类名（Class）**。当你把一段 YAML 提交给集群时，API Server 根据 GVK 来判断这段数据应该用哪个结构体（Struct）来解析。

 **路径中的 GVR (Group, Version, Resource)**

当执行 `curl [http://127.0.0.1:8080/api/v1/namespaces/default/pods](http://127.0.0.1:8080/api/v1/namespaces/default/pods)` 时，路径的每一部分都对应 GVR 的一个组件：

- **Group (资源组)**: 在你的例子中是 **`core`**（核心组）。
  - 注意：核心组在 URL 中比较特殊，它直接以 `/api/v1` 开头。如果是其他组（如 `apps`），路径会是 `/apis/apps/v1`。
- **Version (版本)**: 即 **`v1`**。
- **Resource (资源)**: 即 **`pods`**（复数形式）。

### 实验二：资源创建与删除

创建一个名为 `simple-pod.yaml` 的文件:

```
apiVersion: v1
kind: Pod
metadata:
  name: yaml-direct-upload
  labels:
    env: experiment
spec:
  containers:
  - name: nginx
    image: nginx:alpine
```

使用 `curl` 直接上传:

```
curl -X POST http://127.0.0.1:8080/api/v1/namespaces/default/pods \
     -H "Content-Type: application/yaml" \
     --data-binary @simple-pod.yaml
```

 *预期输出：你会看到一大段 JSON 返回，这是 API Server 接收到请求后，补全了默认值（如 status、uid、创建时间等）后的完整 Pod 对象。*

查看：

```
# 可以通过 kubectl 查看
kubectl get pod

# 也可以通过 curl
curl -X GET http://127.0.0.1:8080/api/v1/namespaces/default/pods/yaml-direct-upload \
     -H "Accept: application/yaml"
```

删除

```
curl -X DELETE http://127.0.0.1:8080/api/v1/namespaces/default/pods/yaml-direct-upload
```



## kubectl raw 方式访问 API

访问 /version

```bash
kubectl get --raw /version
```

查询：

```
kubectl get --raw /api/v1/namespaces/default/pods/yaml-direct-upload
```

API Server 默认返回压缩后的 JSON 以节省带宽，但部分 Kubernetes API 支持通过查询参数要求服务器返回格式化后的结果（不过这取决于具体的 API 版本）：

```
# 尝试在路径后加上 ?pretty=true
kubectl get --raw "/api/v1/namespaces/default/pods/yaml-direct-upload?pretty=true"
```

**总结**

通过 kubectl get --raw 可以实现和 curl 类似的效果，不需要指定 api server 地址和认证信息，默认用了 kubeconfig 中的连接信息。

当然，其实这里使用的 pod 例子有点不合适，因为 Pod 属于核心组，而核心组路径中省略了组名。





# 理解 Client-go

## Client-go 使用示例

### Client-go 集群内认证配置

下面通过 client-go 编写一段代码，完成认证后查询 default 命名空间下的 Pod，并将其名字打印出来。

1. 项目准备

   ```go
   $cd ~/MyoperatorProjects
   $mkdir client-go-examples
   $cd client-go-examples
   $go mod init plus.com/client-go-examples
   $mkdir in-cluster-configuration
   $touch main.go
   ```

2. 业务逻辑

   `main.go`

   ```go
   package main
   
   import (
   	"context"
   	"log"
   	"time"
   
   	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
   	"k8s.io/client-go/kubernetes"
   	"k8s.io/client-go/rest"
   )
   
   func main() {
   	config, err := rest.InClusterConfig()
   	if err != nil {
   		log.Fatal(err)
   	}
   
   	clientset, err := kubernetes.NewForConfig(config)
   	if err != nil {
   		log.Fatal(err)
   	}
   
   	for {
   		pods, err := clientset.CoreV1().Pods("default").
   			List(context.TODO(), metav1.ListOptions{})
   		if err != nil {
   			log.Fatal(err)
   		}
   		log.Printf("There are %d pods in the cluster\n", len(pods.Items))
   		for i, pod := range pods.Items {
   			log.Printf("%d -> %s/%s", i+1, pod.Namespace, pod.Name)
   		}
   		<-time.Tick(5 * time.Second)
   	}
   }
   ```

   **代码逻辑**

   1. 初始化 config:

      ```go
      config, err := rest.InClusterConfig()
      	if err != nil {
      		log.Fatal(err)
      	}
      ```

      在 k8s 中，Pod 创建会把 ServiceAccount token 挂载到容器内 `/var/run/secrets/kubernetes.io/serviceaccount` 路径下，这里 `InClusterConfig()` 这个函数就是基于这个原理读取所需 token 和 ca.crt 两个文件。

   2. 通过 config 初始化 clientset

      ```
      clientset, err := kubernetes.NewForConfig(config)
      	if err != nil {
      		log.Fatal(err)
      	}
      ```

      NewForConfig() 函数返回一个 *Clinetset 对象，通过 clientset 可以实现各种资源的 CRUD 操作。

   3. 通过 clientset 列出特定命名空间里面的所有 Pod

      ```go
      pods, err := clientset.CoreV1().Pods("default").
      			List(context.TODO(), metav1.ListOptions{})
      		if err != nil {
      			log.Fatal(err)
      		}
      ```

      **`clientset.CoreV1().Pods("default").List(...)`**：这是标准的 K8s 客户端链式调用：

      - `CoreV1()`：访问核心（Core）组的 V1 版本 API（Pod 属于核心组）。
      - `Pods("default")`：指定我们要操作的资源是 Pod，并且限定在 **`default` 命名空间**下。
      - `List(...)`：列出该命名空间下的所有 Pod。
      - `context.TODO()`：传入一个空上下文，通常在不需要精细控制超时或取消的简单脚本中使用。
      - `metav1.ListOptions{}`：过滤条件，这里为空，表示查询该命名空间下的**所有** Pod，不作任何筛选。

   4. 打印信息

      ```go
      log.Printf("There are %d pods in the cluster\n", len(pods.Items))
      		for i, pod := range pods.Items {
      			log.Printf("%d -> %s/%s", i+1, pod.Namespace, pod.Name)
      		}
      		<-time.Tick(5 * time.Second)
      ```

3. 编写 Dockerfile

   同一个文件夹下`Dockerfile`

   ```
   FROM busybox
   COPY ./in-cluster /in-cluster
   USER 65532:65532
   ENTRYPOINT /in-cluster
   ```

4. 编译代码

   ```
   cd in-cluster-configuration/
   GOOS=linux go build -o ./in-cluster .
   ```

5. 容器化并加载进集群

   这里使用的是 minikube集群

   ```
   docker build -t in-cluster:v1 .
   minikube image load in-cluster:v1
   ```

6. 创建 clusterrolebinding

   ```
   kubectl create clusterrolebinding defaut-view --clusterrole=view --serviceaccount=default:default
   ```

   允许集群中 `default` 命名空间下的默认服务账户（ServiceAccount），能够读取整个集群中绝大多数的资源信息（如查看 Pod、Deployment 等）。

   `--clusterrole=view`

   view 是 K8s 系统自带的预置角色，对绝大多数资源只有只读权限

   `--serviceaccount=default:default`

   格式：格式为 `[命名空间]:[服务账户名字]`。

   - 前半句 `default`：代表命名空间（Namespace）叫 `default`。
   - 后半句 `default`：代表这个命名空间下自带的、默认的 ServiceAccount。

​	逻辑：`default:default` 账户 ──(通过 `defaut-view` 绑定)──> 获得了 `view` 权限

7. 启动 Pod

   ```
   kubectl run -i in-cluster --image=in-cluster:v1
   ```

   然后就能看到信息被打印出来了



### Client-go 集群外认证配置

1. 准备目录

   ```
   $cd ~/MyoperatorProjects
   $cd client-go-examples
   $mkdir out-of-cluster-configuration
   $touch main.go
   ```

2. 实现业务逻辑

   `main.go`

   ```go
   package main
   
   import (
   	"context"
   	"log"
   	"path/filepath"
   	"time"
   
   	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
   	"k8s.io/client-go/kubernetes"
   	"k8s.io/client-go/tools/clientcmd"
   	"k8s.io/client-go/util/homedir"
   )
   
   func main() {
   	homePath := homedir.HomeDir()
   	if homePath == "" {
   		log.Fatal("failed to get the home directory")
   	}
   
   	kubeconfig := filepath.Join(homePath, ".kube", "config")
   
   	config, err := clientcmd.BuildConfigFromFlags("", kubeconfig)
   	if err != nil {
   		log.Fatal(err)
   	}
   
   	clientset, err := kubernetes.NewForConfig(config)
   	if err != nil {
   		log.Fatal(err)
   	}
   
   	for {
   		pods, err := clientset.CoreV1().Pods("default").
   			List(context.TODO(), metav1.ListOptions{})
   		if err != nil {
   			log.Fatal(err)
   		}
   		log.Printf("There are %d pods in the cluster\n", len(pods.Items))
   		for i, pod := range pods.Items {
   			log.Printf("%d -> %s/%s", i+1, pod.Namespace, pod.Name)
   		}
   		<-time.Tick(5 * time.Second)
   	}
   }
   ```

   **分析**

   这段代码与前面主要区别是获取 *restclient.Config 方式不同，后面 config 使用是一致的。

   1. 获取 kubeconfig 路径

      ```
      homePath := homedir.HomeDir()
      	if homePath == "" {
      		log.Fatal("failed to get the home directory")
      	}
      	
      kubeconfig := filepath.Join(homePath, ".kube", "config")
      ```

      这里通过 "k8s.io/client-go/util/homedir" 包提供的 HomeDir 获取用户家目录，然后拼接 kubeconfig 的地址。/home/user/.kube/config

   2. 通过 kubeconfig 初始化 config

      ```
      config, err := clientcmd.BuildConfigFromFlags("", kubeconfig)
      	if err != nil {
      		log.Fatal(err)
      	}
      ```

      第一个参数是 k8s API Server 的直接集群地址，通常在开发时，API Server 的地址已经写在kubeconfig 文件里了。如果你传了空字符串，Go 就会自动去第二个参数（`kubeconfig` 文件）里读取地址。只有当你不想用文件里的地址、想要强行覆盖它时，才会在这里传值。

      第二个参数 `kubeconfig`代表本地 `kubeconfig` 文件的**绝对路径**，Go 会去读取这个文件，解析出当前激活的集群上下文（Current Context）、证书数据和用户名。

      函数同样返回一个 *Config 对象，拿到 *Config 后，就能进一步初始化 ClinetSet。

   3. 编译运行

      ```
      cd oout-of-cluster-configuration/
      go build -o out-of-cluster
      ./out-of-cluster
      ```



### Cilent-go 操作 Deployment

Deployment 资源的创建、更新和删除。

`main.go`

```go
package main

import (
	"context"
	"log"
	"path/filepath"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	v1 "k8s.io/client-go/kubernetes/typed/apps/v1"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
	"k8s.io/client-go/util/retry"
)

func main() {
	homePath := homedir.HomeDir()
	if homePath == "" {
		log.Fatal("failed to get the home directory")
	}

	kubeconfig := filepath.Join(homePath, ".kube", "config")

	config, err := clientcmd.BuildConfigFromFlags("", kubeconfig)
	if err != nil {
		log.Fatal(err)
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Fatal(err)
	}

	dpClient := clientset.AppsV1().
		Deployments(corev1.NamespaceDefault)

	log.Println("create Deployment")
	if err := createDeployment(dpClient); err != nil {
		log.Fatal(err)
	}
	<-time.Tick(1 * time.Minute)

	log.Println("update Deployment")
	if err := updateDeployment(dpClient); err != nil {
		log.Fatal(err)
	}
	<-time.Tick(1 * time.Minute)

	log.Println("delete Deployment")
	if err := deleteDeployment(dpClient); err != nil {
		log.Fatal(err)
	}
	<-time.Tick(1 * time.Minute)

	log.Println("end")
}

func createDeployment(dpClient v1.DeploymentInterface) error {
	replicas := int32(3)
	newDp := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name: "nginx-deploy",
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{
					"app": "nginx",
				},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"app": "nginx",
					},
				},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{
							Name:  "nginx",
							Image: "nginx:1.14",
							Ports: []corev1.ContainerPort{
								{
									Name:          "http",
									Protocol:      corev1.ProtocolTCP,
									ContainerPort: 80,
								},
							},
						},
					},
				},
			},
		},
	}

	_, err := dpClient.Create(context.TODO(),
		newDp, metav1.CreateOptions{})
	return err
}

func updateDeployment(dpClient v1.DeploymentInterface) error {
	dp, err := dpClient.Get(context.TODO(),
		"nginx-deploy", metav1.GetOptions{})
	if err != nil {
		return err
	}
	dp.Spec.Template.Spec.Containers[0].Image = "nginx:1.16"

	return retry.RetryOnConflict(
		retry.DefaultRetry, func() error {
			_, err = dpClient.Update(context.TODO(),
				dp, metav1.UpdateOptions{})
			return err
		},
	)
}

func deleteDeployment(dpClient v1.DeploymentInterface) error {
	deletePolicy := metav1.DeletePropagationForeground
	return dpClient.Delete(
		context.TODO(), "nginx-deploy", metav1.DeleteOptions{
			PropagationPolicy: &deletePolicy,
		},
	)
}
```

测试运行

```
$cd handle-deployment/
$go run main
```

接下来就能通过 kubectl 命令看见资源的创建 、更新和删除了。

#### 源码解析

**main 函数**

```go
func main() {
	homePath := homedir.HomeDir()
	if homePath == "" {
		log.Fatal("failed to get the home directory")
	}

	kubeconfig := filepath.Join(homePath, ".kube", "config")

	config, err := clientcmd.BuildConfigFromFlags("", kubeconfig)
	if err != nil {
		log.Fatal(err)
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Fatal(err)
	}

	dpClient := clientset.AppsV1().
		Deployments(corev1.NamespaceDefault)

	log.Println("create Deployment")
	if err := createDeployment(dpClient); err != nil {
		log.Fatal(err)
	}
	<-time.Tick(1 * time.Minute)

	log.Println("update Deployment")
	if err := updateDeployment(dpClient); err != nil {
		log.Fatal(err)
	}
	<-time.Tick(1 * time.Minute)

	log.Println("delete Deployment")
	if err := deleteDeployment(dpClient); err != nil {
		log.Fatal(err)
	}
	<-time.Tick(1 * time.Minute)

	log.Println("end")
}
```

前面从 config 到 clientset 的逻辑和前面的示例一样。

后面的 dpClien是通过clientset.AppsV1().Deployments(corev1.NamespaceDefault) 调用获得的，这是一个 DeploymentInterface 类型，可以用来对 Deployment 类型进行各种操作，比如 Get()、List()、Watch()、Create()、Update()、Delete()、Patch()等

接着是 create、update、delete三个函数的调用，间隔是一分钟。

**cteateDeployment()函数**

```go
func createDeployment(dpClient v1.DeploymentInterface) error {
	replicas := int32(3)
	newDp := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name: "nginx-deploy",
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{
					"app": "nginx",
				},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"app": "nginx",
					},
				},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{
							Name:  "nginx",
							Image: "nginx:1.14",
							Ports: []corev1.ContainerPort{
								{
									Name:          "http",
									Protocol:      corev1.ProtocolTCP,
									ContainerPort: 80,
								},
							},
						},
					},
				},
			},
		},
	}

	_, err := dpClient.Create(context.TODO(),
		newDp, metav1.CreateOptions{})
	return err
}

```

这段代码看着很多，但逻辑其实很简单。把 Deployment 对象的赋值折叠起来，剩下逻辑就几行：

```go
replicas := int32(3)
newDp := &appsv1.Deployment{...}
_, err := dpClient.Create(context.TODO(),newDp, metav1.CreateOptions{})
return err
```

创建一个 Deployement 就这几行，先构造一个 newDp，然后调用 dpClient 的 dpClient 的 Create() 函数来创建这个 Deployment。newDp 中配置内容和前面用过的 nginx-deploy 是完全一样的，这里镜像版本设置了 nginx:1.14，副本数是 3，等下更新操作会把这个镜像改为 nginx:1.16。

**updateDeployment()函数**

```go
func updateDeployment(dpClient v1.DeploymentInterface) error {
	dp, err := dpClient.Get(context.TODO(),
		"nginx-deploy", metav1.GetOptions{})
	if err != nil {
		return err
	}
	dp.Spec.Template.Spec.Containers[0].Image = "nginx:1.16"

	return retry.RetryOnConflict(
		retry.DefaultRetry, func() error {
			_, err = dpClient.Update(context.TODO(),
				dp, metav1.UpdateOptions{})
			return err
		},
	)
}
```

逻辑主要分三步：

1. 获取 nginx-deploy:

   ```
   	dp, err := dpClient.Get(context.TODO(),
   		"nginx-deploy", metav1.GetOptions{})
   	if err != nil {
   		return err
   	}
   ```

   通过 dpClient 的 Get() 方法获取到一个 *Deployment 对象，然后就可以操作这个对象了。

2. 修改镜像字段

   ```go
   dp.Spec.Template.Spec.Containers[0].Image = "nginx:1.16"
   ```

   这里把 Image 配置成 nginx:1.16，这样会触发一次 Pod 的滚动更新。

3. 调用 Update() 函数完成更新

   ```go
   	return retry.RetryOnConflict(
   		retry.DefaultRetry, func() error {
   			_, err = dpClient.Update(context.TODO(),
   				dp, metav1.UpdateOptions{})
   			return err
   		},
   	)
   ```

   主要逻辑是调用 dpClient.Update() 来完成 Deployment 的关系。外层包的 RetryOnConflict() 函数只是一种健壮性的手段，如果 Update 过程失败了，这里能提供重试机制。RetryOnConflict() 的函数签名是这样的：

   ```
   RetryOnConflict(backoff wait.Backoff, fn func() error) error
   ```

**deleteDeployment()函数**

```go
func deleteDeployment(dpClient v1.DeploymentInterface) error {
	deletePolicy := metav1.DeletePropagationForeground
	return dpClient.Delete(
		context.TODO(), "nginx-deploy", metav1.DeleteOptions{
			PropagationPolicy: &deletePolicy,
		},
	)
}
```

这里同样用 dpClient() 的 Delete() 方法完成删除操作，里面的 PropagationPolicy 属性配置了 metav1.DeletePropagationForeground，这里有三种可选特性：

- DeletePropagationOrphan：不考虑依赖资源
- DeletePropagationBackground：后台删除依赖资源
- DeletePropagationForeground：前台删除依赖资源





# Operator 开发进阶

在开发中需要为这个 Operator 设置 RBAC 权限，添加方法是通过注释进行配置，工具会自动生成相应配置文件。

这里有一个问题，就是注释表示不能紧贴函数或方法，Kubebuilder marker 永远独立成块写。

我们以为这个 marker 是函数注释，但实际上更像是文件级声明，很多时候它只是恰好写在函数前面。虽然胡涛在书里提到这是个问题，应该被社区所修复。但这么久没有修复也就证明了这应该上面说的原因，不应该当成注释，应该独立成块写。





# Kubernetes 机制

## Informer 机制

控制器需要与 API Server 通信，轮询的话容易集群扩大后API Server 会直接被高频的 HTTP 请求冲垮。而长连接机制容易增加控制器性能开销。

**Informer 的出现就是为了完美平衡“实时性”与“高性能”。** 它在客户端建立了一个**本地缓存（Local Cache）**，让控制器绝大多数时候只需读取本地内存，只有在数据真正变动时才通过 Watch 接收增量更新。

**Informer 的核心架构组件**

```
+-------------------------------------------------------------------------+
|                                API Server                               |
+-------------------------------------------------------------------------+
       ^                          |
       | List                     | Watch (HTTP Chunked)
       v                          v
+-------------------------------------------------------------------------+
|                               Reflector                                 |
+-------------------------------------------------------------------------+
                                  |
                                  | Push (DeltaFIFO.Add)
                                  v
+-------------------------------------------------------------------------+
|                               DeltaFIFO                                 |
+-------------------------------------------------------------------------+
                                  |
               Pop ---------------+---------------+
               |                                  |
               v                                  v
+------------------------------+  Distribute  +---------------------------+
|      Local Store (Indexer)   | <------------|       Controller /        |
|  (Thread-Safe Memory Cache)  |              |    ResourceEventHandler   |
+------------------------------+              +---------------------------+
                                                          |
                                                          | Trigger
                                                          v
                                              +---------------------------+
                                              |        WorkQueue          |
                                              +---------------------------+
```

1. Reflector（反射器）

   - **List：** 启动时，它会调用 API Server 的 `List` 接口，把某种资源（比如所有的 Pod）全量拉取过来。

   - **Watch：** 全量拉取完成后，它通过 `Watch` 机制与 API Server 保持长连接。一旦 API Server 里的资源发生变动（Create/Update/Delete），Reflector 就会实时收到事件通知。

   - **动作：** 收到事件后，Reflector 将这些事件转化为“增量（Delta）”，然后塞进 `DeltaFIFO` 队列中。

2.  DeltaFIFO（增量先进先出队列）

   这是一个特殊的先入先出队列。

   - **“Delta”指的是变化：** 比如“Pod A 被创建了（Added）”、“Pod B 被更新了（Updated）”。
   - **去重与合并：** 它是它的精妙之处。如果控制器处理得慢，同一个 Pod 连续发生了多次快速更新，DeltaFIFO 会自动把这些增量合并（比如连续两个 Update 合并为一个），避免队列臃肿。

3.  Indexer（带索引的本地缓存）

   - 它是存储在控制器本地内存中的一个**线程安全（Thread-Safe）的 Cache**。
   - **它的工作：** 从 DeltaFIFO 中消费出来的资源对象，会被同步到这个本地 Cache 中。
   - **为什么叫 Indexer？** 因为它不仅存数据，还能**建立索引**。默认的索引器是 `Namespace`。这意味着你可以像查 SQL 一样，极快地在内存中查询“Namespace 'default' 下有哪些 Pod”，而不需要遍历整个 Cache。

4.  ResourceEventHandler（事件处理器）

   这就是**编写业务逻辑的入口**。当向 Informer 注册了事件监听器后，它会提供三个回调函数：

   - `OnAdd(obj interface{})`：新对象创建时触发。
   - `OnUpdate(oldObj, newObj interface{})`：对象被修改时触发。
   - `OnDelete(obj interface{})`：对象被删除时触发。

   通常，在这些回调函数里，我们**不会直接编写复杂的耗时业务**，而是把该对象的“Key”（通常是 `namespace/name`）丢进一个 **WorkQueue（工作队列）** 里，让背后的多个 Worker 协程去异步消费。

当在集群里执行了 `kubectl apply -f my-pod.yaml`，Informer 内部是如何流转的？

1. **API Server** 写入 etcd 成功，触发 Watch 事件。
2. **Reflector** 监听到该 Pod 的 `Added` 事件，将其封装成 Delta 写入 **DeltaFIFO**。
3. Informer 的后台循环（Controller 循环）不断从 **DeltaFIFO** 弹出（Pop）这个事件。
4. **首先**，它把这个 Pod 对象更新到本地的 **Indexer（内存缓存）** 中。
5. **然后**，它把事件分发给你注册的 **ResourceEventHandler**，触发 `OnAdd` 方法。
6. 在 `OnAdd` 中，你把这个 Pod 的名字符串（如 `default/my-pod`）丢进 **WorkQueue**。
7. 你的 **Worker 协程** 从 WorkQueue 拿到这个名字，**直接去本地 Indexer 查内存**拿到 Pod 详情，执行你的核心控制器逻辑（比如去配置网络或存储）。















































