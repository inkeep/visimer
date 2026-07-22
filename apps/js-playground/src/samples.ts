export interface Sample {
  /** must match a DiagramTypeInfo id from @visimer/core */
  typeId: string
  title: string
  code: string
}

export const SAMPLES: Sample[] = [
  {
    typeId: 'flowchart',
    title: 'Flowchart — order flow',
    code: `flowchart TD
  %% double-click nodes to rename, drag with Connect tool
  A[Customer order] --> B{In stock?}
  B -->|yes| C[Reserve items]
  B -->|no| D[Backorder]
  C --> E([Charge payment])
  D --> E
  E --> F{{Ship}}
`,
  },
  {
    typeId: 'flowchart',
    title: 'Flowchart — architecture',
    code: `flowchart LR
  subgraph client [Client]
    UI[Web app]
  end
  subgraph api [API layer]
    GW[Gateway] --> SVC[Service]
  end
  UI --> GW
  SVC --> DB[(Postgres)]
  SVC -.-> CACHE[(Redis)]
  classDef store fill:#334155,stroke:#94a3b8,color:#fff
  class DB,CACHE store
`,
  },
  {
    typeId: 'sequence',
    title: 'Sequence diagram',
    code: `sequenceDiagram
  participant Alice
  participant Bob
  Alice->>Bob: Hello Bob, how are you?
  alt is sick
    Bob-->>Alice: Not so good :(
  else is well
    Bob-->>Alice: Feeling fresh!
  end
  Bob->>Alice: See you later!
`,
  },
  {
    typeId: 'class',
    title: 'Class diagram',
    code: `classDiagram
  Animal <|-- Duck
  Animal <|-- Fish
  Animal : +int age
  Animal : +String gender
  Animal : +isMammal()
  class Duck{
    +String beakColor
    +swim()
    +quack()
  }
  class Fish{
    -int sizeInFeet
    -canEat()
  }
`,
  },
  {
    typeId: 'state',
    title: 'State diagram',
    code: `stateDiagram-v2
  [*] --> Still
  Still --> [*]
  Still --> Moving
  Moving --> Still
  Moving --> Crash
  Crash --> [*]
`,
  },
  {
    typeId: 'er',
    title: 'Entity relationship',
    code: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE-ITEM : contains
  CUSTOMER }|..|{ DELIVERY-ADDRESS : uses
`,
  },
  {
    typeId: 'journey',
    title: 'User journey',
    code: `journey
  title My working day
  section Go to work
    Make tea: 5: Me
    Go upstairs: 3: Me
    Do work: 1: Me, Cat
  section Go home
    Go downstairs: 5: Me
    Sit down: 5: Me
`,
  },
  {
    typeId: 'gantt',
    title: 'Gantt chart',
    code: `gantt
  title A Gantt Diagram
  dateFormat YYYY-MM-DD
  section Section
    A task          :a1, 2026-01-01, 30d
    Another task    :after a1, 20d
  section Another
    Task in Another :2026-01-12, 12d
    another task    :24d
`,
  },
  {
    typeId: 'pie',
    title: 'Pie chart',
    code: `pie showData
  title Key elements in Product X
  "Calcium" : 42.96
  "Potassium" : 50.05
  "Magnesium" : 10.01
  "Iron" : 5
`,
  },
  {
    typeId: 'quadrant',
    title: 'Quadrant chart',
    code: `quadrantChart
  title Reach and engagement of campaigns
  x-axis Low Reach --> High Reach
  y-axis Low Engagement --> High Engagement
  quadrant-1 We should expand
  quadrant-2 Need to promote
  quadrant-3 Re-evaluate
  quadrant-4 May be improved
  Campaign A: [0.3, 0.6]
  Campaign B: [0.45, 0.23]
  Campaign C: [0.57, 0.69]
`,
  },
  {
    typeId: 'requirement',
    title: 'Requirement diagram',
    code: `requirementDiagram
  requirement test_req {
    id: 1
    text: the test text.
    risk: high
    verifymethod: test
  }
  element test_entity {
    type: simulation
  }
  test_entity - satisfies -> test_req
`,
  },
  {
    typeId: 'gitgraph',
    title: 'Gitgraph',
    code: `gitGraph
  commit
  commit
  branch develop
  checkout develop
  commit
  commit
  checkout main
  merge develop
  commit
`,
  },
  {
    typeId: 'c4',
    title: 'C4 context',
    code: `C4Context
  title System Context diagram for Internet Banking System
  Person(customerA, "Banking Customer A", "A customer of the bank.")
  System(SystemAA, "Internet Banking System", "Allows customers to check accounts.")
  System_Ext(SystemE, "Mainframe Banking System", "Stores core banking information.")
  Rel(customerA, SystemAA, "Uses")
  Rel(SystemAA, SystemE, "Uses")
`,
  },
  {
    typeId: 'mindmap',
    title: 'Mindmap',
    code: `mindmap
  root((visimer))
    Parsing
      Lossless CST
      Statement classifier
    Editing
      Semantic ops
      Minimal diffs
    Rendering
      Mermaid SVG
      Interaction overlay
`,
  },
  {
    typeId: 'timeline',
    title: 'Timeline',
    code: `timeline
  title History of Social Media Platform
  2002 : LinkedIn
  2004 : Facebook
       : Google
  2005 : YouTube
  2006 : Twitter
`,
  },
  {
    typeId: 'zenuml',
    title: 'ZenUML (plugin)',
    code: `zenuml
  title Order Service
  @Actor Client
  @Boundary OrderController
  Client->OrderController.post(payload) {
    return ok
  }
`,
  },
  {
    typeId: 'sankey',
    title: 'Sankey',
    code: `sankey-beta
Agricultural 'waste',Bio-conversion,124.729
Bio-conversion,Liquid,0.597
Bio-conversion,Losses,26.862
Bio-conversion,Solid,280.322
Bio-conversion,Gas,81.144
`,
  },
  {
    typeId: 'xychart',
    title: 'XY chart',
    code: `xychart-beta
  title "Sales Revenue"
  x-axis [jan, feb, mar, apr, may, jun]
  y-axis "Revenue (in $)" 4000 --> 11000
  bar [5000, 6000, 7500, 8200, 9500, 10500]
  line [5000, 6000, 7500, 8200, 9500, 10500]
`,
  },
  {
    typeId: 'block',
    title: 'Block diagram',
    code: `block-beta
columns 1
  db(("DB"))
  blockArrowId6<["&nbsp;&nbsp;&nbsp;"]>(down)
  block:ID
    A
    B["A wide one in the middle"]
    C
  end
  space
  D
  ID --> D
  C --> D
  style B fill:#969,stroke:#333,stroke-width:4px
`,
  },
  {
    typeId: 'packet',
    title: 'Packet',
    code: `packet-beta
0-15: "Source Port"
16-31: "Destination Port"
32-63: "Sequence Number"
64-95: "Acknowledgment Number"
`,
  },
  {
    typeId: 'kanban',
    title: 'Kanban',
    code: `kanban
  Todo
    [Create Documentation]
    docs[Create Blog about the new diagram]
  [In progress]
    id6[Create renderer so that it works in all cases]
  id9[Ready for deploy]
    id8[Design grammar]
`,
  },
  {
    typeId: 'architecture',
    title: 'Architecture',
    code: `architecture-beta
  group api(cloud)[API]

  service db(database)[Database] in api
  service disk1(disk)[Storage] in api
  service disk2(disk)[Storage] in api
  service server(server)[Server] in api

  db:L -- R:server
  disk1:T -- B:server
  disk2:T -- B:db
`,
  },
  {
    typeId: 'radar',
    title: 'Radar',
    code: `radar-beta
  title Grades
  axis m["Math"], s["Science"], e["English"]
  axis h["History"], g["Geography"], a["Art"]
  curve alice["Alice"]{85, 90, 80, 70, 75, 90}
  curve bob["Bob"]{70, 75, 85, 80, 90, 85}
  max 100
  min 0
`,
  },
  {
    typeId: 'treemap',
    title: 'Treemap',
    code: `treemap-beta
"Products"
    "Electronics"
        "Phones": 50
        "Laptops": 30
    "Furniture"
        "Chairs": 20
        "Tables": 15
`,
  },
]
